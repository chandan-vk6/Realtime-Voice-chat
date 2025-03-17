from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect, UploadFile, File, Form
from fastapi.responses import JSONResponse, HTMLResponse
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
import hashlib
import requests
import base64
import os
from openai import OpenAI
import json
from elevenlabs.client import ElevenLabs
from elevenlabs import play
import io
from tempfile import NamedTemporaryFile
import uuid
import time
import redis
from dotenv import load_dotenv
from typing import List, Dict, Optional
import uvicorn
from typing import Iterator, List
from fastapi.middleware.cors import CORSMiddleware

# Load environment variables
load_dotenv()

# Create FastAPI app
app = FastAPI(title="Real-time Voice AI Assistant API")


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Setup Jinja2 templates
templates = Jinja2Templates(directory="templates")

# Pydantic models for request/response validation
class TranscriptionRequest(BaseModel):
    audio_data: str  # Base64 encoded audio data

class TranscriptionResponse(BaseModel):
    text: str

class LLMRequest(BaseModel):
    message: str
    # conversation_history: Optional[List[Dict[str, str]]] = []
    session_id: str

class LLMResponse(BaseModel):
    response: str

class TTSRequest(BaseModel):
    text: str

class TTSResponse(BaseModel):
    audio_data: str  # Base64 encoded audio data




# Connect to Redis
redis_client = redis.StrictRedis(host='localhost', port=6379, decode_responses=True)

# Connection manager for WebSockets
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def send_message(self, websocket: WebSocket, message: str):
        await websocket.send_text(message)

manager = ConnectionManager()

@app.get('/api/config')
async def get_config():
    return JSONResponse(content={
        'google_api_key': os.environ.get('GOOGLE_API_KEY'),
        'google_client_id': os.environ.get('GOOGLE_CLIENT_ID')
    })


# Routes
@app.get("/", response_class=HTMLResponse)
async def get_html(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

# Improved error handling for REST API endpoints
@app.post("/api/transcribe", response_model=TranscriptionResponse)
async def transcribe(request: TranscriptionRequest):
    try:
        # Decode base64 audio data
        audio_bytes = base64.b64decode(request.audio_data)
        
        # Transcribe using AssemblyAI
        transcription = transcribe_audio(audio_bytes)
        
        return TranscriptionResponse(text=transcription)
    except Exception as e:
        print(f"Transcription error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Transcription error: {str(e)}")

@app.post("/api/llm", response_model=LLMResponse)
async def get_llm(request: LLMRequest):
    try:
        # Get response from LLM
        response = get_llm_response(user_input=request.message, session_id=request.session_id)
        
        return LLMResponse(response=response)
    except Exception as e:
        print(f"LLM error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"LLM error: {str(e)}")

@app.post("/api/tts", response_model=TTSResponse)
async def text_to_speech_endpoint(request: TTSRequest):
    try:
        # Convert text to speech
        audio_data = text_to_speech(request.text)
        
        # Encode audio data as base64
        encoded_audio = base64.b64encode(audio_data).decode('utf-8')
        
        return TTSResponse(audio_data=encoded_audio)
    except Exception as e:
        print(f"TTS error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"TTS error: {str(e)}")

@app.post("/api/tts/stream")
async def text_to_speech_stream(request: TTSRequest):
    try:
        # Get streaming audio generator
        audio_stream = text_to_speech_streaming(request.text)
        
        # Return a streaming response
        return StreamingResponse(
            audio_stream,
            media_type="audio/mpeg",
            headers={
                "Content-Disposition": "attachment; filename=speech.mp3",
                "Transfer-Encoding": "chunked"
            }
        )
    except Exception as e:
        print(f"TTS streaming error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"TTS streaming error: {str(e)}")

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Receive data from client
            data = await websocket.receive_text()
            
            # Parse the JSON message
            message = json.loads(data)
            
            try:
                if message["type"] == "audio":
                    # Process audio input
                    # Decode base64 audio data
                    audio_bytes = base64.b64decode(message["audio_data"])
                    
                    # Transcribe audio
                    transcription = transcribe_audio(audio_bytes)
                    
                    # Send transcription back to client
                    await manager.send_message(websocket, json.dumps({
                        "type": "transcription",
                        "text": transcription
                    }))
                    
                    # Get LLM response
                    session_id = message.get("session_id", "")
                    # conversation_history = message.get("conversation_history", [])
                    llm_response = get_llm_response(transcription, session_id)
                    
                    # Send LLM response back to client
                    await manager.send_message(websocket, json.dumps({
                        "type": "llm_response",
                        "text": llm_response
                    }))
                    
                    # Generate TTS audio
                    audio_data = text_to_speech(llm_response)
                    encoded_audio = base64.b64encode(audio_data).decode('utf-8')
                    
                    # Send TTS audio back to client
                    await manager.send_message(websocket, json.dumps({
                        "type": "tts",
                        "audio_data": encoded_audio
                    }))
                
                elif message["type"] == "text":
                    # Process text input
                    user_message = message["message"]
                    # conversation_history = message.get("conversation_history", [])
                    session_id = message.get("session_id", "")
                    
                    # Get LLM response
                    llm_response = get_llm_response(user_message, session_id)
                    
                    # Send LLM response back to client
                    await manager.send_message(websocket, json.dumps({
                        "type": "llm_response",
                        "text": llm_response
                    }))
                    
                    # Generate TTS audio
                    audio_data = text_to_speech(llm_response)
                    encoded_audio = base64.b64encode(audio_data).decode('utf-8')
                    
                    # Send TTS audio back to client
                    await manager.send_message(websocket, json.dumps({
                        "type": "tts",
                        "audio_data": encoded_audio
                    }))
                
                else:
                    # Unknown message type
                    await manager.send_message(websocket, json.dumps({
                        "type": "error",
                        "error": f"Unknown message type: {message['type']}"
                    }))
            
            except Exception as e:
                # Send error message back to client
                await manager.send_message(websocket, json.dumps({
                    "type": "error",
                    "error": str(e)
                }))
                
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        print(f"WebSocket error: {str(e)}")
        try:
            await manager.send_message(websocket, json.dumps({
                "type": "error",
                "error": f"WebSocket error: {str(e)}"
            }))
        except:
            pass
        manager.disconnect(websocket)


def create_vector_store(client):
    try:
        vector_store = client.vector_stores.create(name=f"knowledge_base_{uuid.uuid4()}")
        return vector_store.id
    except Exception as e:
        return None
    
async def upload_file_to_openai(uploaded_file, client):
    with NamedTemporaryFile(delete=False, suffix=f"_{uploaded_file.filename}") as tmp_file:
        # Await the read() coroutine
        file_content = await uploaded_file.read()
        tmp_file.write(file_content)
        tmp_file_path = tmp_file.name
    
    try:
        with open(tmp_file_path, "rb") as file_content:
            response = client.files.create(file=file_content, purpose="assistants")
        os.remove(tmp_file_path)
        return response.id
    except Exception as e:
        if os.path.exists(tmp_file_path):
            os.remove(tmp_file_path)
        return None
    
def add_file_to_vector_store(vector_store_id, file_id, client):
    try:
        result = client.vector_stores.files.create(
            vector_store_id=vector_store_id, file_id=file_id
        )
        return result
    except Exception as e:
        return None




@app.post("/api/upload")
async def upload_files(files: List[UploadFile] = File(...), session_id: str = Form(...)):
    try:
        client = OpenAI(api_key=os.getenv('LLM_API_KEY'))
        vector_store_id = redis_client.get(session_id)

        if not vector_store_id:
            vector_store_id = create_vector_store(client)
            if not vector_store_id:
                return JSONResponse(content={"error": "Failed to create vector store"}, status_code=500)
            redis_client.set(session_id, vector_store_id, ex=3600)

        file_ids = []
        for uploaded_file in files:
            # Compute hash of file content
            file_content = await uploaded_file.read()
            file_hash = hashlib.sha256(file_content).hexdigest()  # Use SHA256 for uniqueness
            uploaded_file.file.seek(0)  # Reset file pointer after reading
            # Log file details
            print(f"Uploading file: {uploaded_file.filename}")
            print(f"MIME Type: {uploaded_file.content_type}")
            print(f"First 100 bytes: {file_content[:100]}")
            # Check if the exact file already exists (hash comparison)
            existing_file_id = redis_client.hget(f"session:{session_id}:file_hashes", file_hash)
            if existing_file_id:
                file_ids.append(existing_file_id)  # Skip re-upload
                continue

            # Upload file to OpenAI
            file_id = await upload_file_to_openai(uploaded_file, client)
            if file_id:
                file_ids.append(file_id)
                add_file_to_vector_store(vector_store_id, file_id, client)

                # Store filename, file ID, and hash in Redis
                redis_client.hset(f"session:{session_id}:files", file_id, uploaded_file.filename)
                redis_client.hset(f"session:{session_id}:file_hashes", file_hash, file_id)

        return JSONResponse(
            content={"message": f"Successfully uploaded {len(file_ids)} new file(s)", "session_id": session_id},
            status_code=200
        )

    except redis.exceptions.RedisError as e:
        return JSONResponse(content={"error": f"Redis error: {str(e)}"}, status_code=500)
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)


@app.delete("/api/delete-file")
async def delete_file(filename: str, file_hash: str, session_id: str):
    try:
        client = OpenAI(api_key=os.getenv('LLM_API_KEY'))
        vector_store_id = redis_client.get(session_id)

        if not vector_store_id:
            return JSONResponse(content={"error": "Vector store not found"}, status_code=404)

        # Find the file_id using the provided hash
        file_id = redis_client.hget(f"session:{session_id}:file_hashes", file_hash)

        if not file_id:
            return JSONResponse(content={"error": "File not found"}, status_code=404)

        # Remove file from OpenAI vector store
        client.vector_stores.files.delete(vector_store_id=vector_store_id, file_id=file_id)

        # Remove file ID and hash from Redis
        redis_client.hdel(f"session:{session_id}:files", file_id)
        redis_client.hdel(f"session:{session_id}:file_hashes", file_hash)
        print(f'sucessfully deleted {file_id}')
        return JSONResponse(content={"message": "File deleted successfully"}, status_code=200)

    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)

# Function to transcribe audio using AssemblyAI
def transcribe_audio(audio_bytes):
    # Set up AssemblyAI API
    assembly_api_key = os.getenv("ASSEMBLYAI_API_KEY")
    headers = {
        "authorization": assembly_api_key,
        "content-type": "application/json"
    }
    
    # Upload the audio file to AssemblyAI
    upload_endpoint = "https://api.assemblyai.com/v2/upload"
    upload_response = requests.post(
        upload_endpoint,
        headers=headers,
        data=audio_bytes
    )
    
    if upload_response.status_code != 200:
        raise Exception(f"Upload failed: {upload_response.text}")
        
    audio_url = upload_response.json()["upload_url"]
    
    # Request transcription
    transcript_endpoint = "https://api.assemblyai.com/v2/transcript"
    transcript_request = {
        "audio_url": audio_url,
        "language_code": "en"  # Change as needed for other languages
    }
    transcript_response = requests.post(
        transcript_endpoint,
        json=transcript_request,
        headers=headers
    )
    
    if transcript_response.status_code != 200:
        raise Exception(f"Transcription request failed: {transcript_response.text}")
        
    transcript_id = transcript_response.json()["id"]
    
    # Poll for transcription completion
    polling_endpoint = f"https://api.assemblyai.com/v2/transcript/{transcript_id}"
    while True:
        polling_response = requests.get(polling_endpoint, headers=headers)
        polling_response_json = polling_response.json()
        
        if polling_response_json["status"] == "completed":
            return polling_response_json["text"]
        elif polling_response_json["status"] == "error":
            raise Exception(f"Transcription error: {polling_response_json['error']}")
        
        time.sleep(1)
# New streaming function
def text_to_speech_streaming(text: str) -> Iterator[bytes]:
    client = ElevenLabs(
        api_key=os.getenv("ELEVENLABS_API_KEY"),
    )
    
    # Use the streaming option
    audio_stream = client.text_to_speech.convert(
        text=text,
        voice_id="JBFqnCBsd6RMkjVDRZzb",
        model_id="eleven_multilingual_v2",
        output_format="mp3_44100_128",
        stream=True  # Enable streaming
    )
    
    # Simply yield chunks as they come
    for chunk in audio_stream:
        yield chunk

# Alternative version with chunking and ID3 header handling
def text_to_speech_streaming_with_headers(text: str) -> Iterator[bytes]:
    client = ElevenLabs(
        api_key=os.getenv("ELEVENLABS_API_KEY"),
    )
    
    audio_stream = client.text_to_speech.convert(
        text=text,
        voice_id="JBFqnCBsd6RMkjVDRZzb",
        model_id="eleven_multilingual_v2",
        output_format="mp3_44100_128",
        stream=True
    )
    
    # First chunk needs special handling to include headers
    first_chunk = True
    for chunk in audio_stream:
        if first_chunk:
            # The first chunk contains necessary MP3 headers
            first_chunk = False
            yield chunk
        else:
            # Subsequent chunks
            yield chunk
# Function to get response from LLM
def get_llm_response(user_input, session_id):
    # CHAT_WEBHOOK_URL = "http://localhost:5678/webhook/invoke_agent"
    # Fetch the OpenAI API key from environment variables
    # openai_api_key = os.getenv("LLM_API_KEY")  
    # openai_api_url = "https://api.openai.com/v1/chat/completions"  

    # headers = {
    #     "Authorization": f"Bearer {openai_api_key}",
    #     "Content-Type": "application/json"
    # }
    
    # # Format conversation history
    # all_messages = []
    # for message in conversation_history:
    #     all_messages.append({"role": message["role"], "content": message["content"]})
    
    # all_messages.append({"role": "user", "content": user_input})
    
    # data = {
    #     "model": "gpt-4o-mini",  # Use "gpt-3.5-turbo" if needed
    #     "messages": all_messages,
    #     "max_tokens": 500
    # }
    
    # response = requests.post(openai_api_url, headers=headers, json=data)
    # response.raise_for_status()  # Raise an exception for bad status codes
    # response_json = response.json()
    
    # # Extract the assistant's reply from the response
    # assistant_response = response_json["choices"][0]["message"]["content"]
    # return assistant_response
    print(session_id)
    try:
        client = OpenAI(api_key=os.getenv('LLM_API_KEY'))
        if redis_client.exists(session_id):
            vector_store_id = redis_client.get(session_id)
            print(f"Vector store ID: {vector_store_id}")
        else:
            print("No vector store ID found for session ID.")
            return 'Please upload and process documents first.'
        
        response = client.responses.create(
            instructions="""You are a helpful assistant that only answers questions based on the 
                documents provided. If the question cannot be answered using the documents or is outside 
                their scope, respond with "I don't know" or "I cannot answer this question based on the 
                documents provided." Do not use any knowledge outside of the provided documents.""",
            model="gpt-4o-mini",
            input=user_input,
            tools=[{
                "type": "file_search", 
                "vector_store_ids": [vector_store_id]
            }],
            temperature=0
            # tool_choice="auto"
        )
        print(f"Response received: {response.output_text}")
    except Exception as e:
        import traceback
        print(f"Error processing request: {e}")
        print(traceback.format_exc())
        return 'An error occurred while processing your request.'
    # Display the response
    return response.output_text

# Function to convert text to speech using AssemblyAI
def text_to_speech(text):
    client = ElevenLabs(
        api_key=os.getenv("ELEVENLABS_API_KEY"),
    )
    audio = client.text_to_speech.convert(
        text=text,
        voice_id="JBFqnCBsd6RMkjVDRZzb",
        model_id="eleven_multilingual_v2",
        output_format="mp3_44100_128",
    )
    # play(audio)
    
    if audio:
        # Convert generator to bytes
        audio_bytes = b"".join(audio)
        return audio_bytes
    else:
        raise Exception(f"TTS API Error")

# For local development
if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)