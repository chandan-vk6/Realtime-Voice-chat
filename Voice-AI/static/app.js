// App.js - Real-time Voice AI Assistant

document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const startRecordingBtn = document.getElementById('startRecording');
    const stopRecordingBtn = document.getElementById('stopRecording');
    const clearConversationBtn = document.getElementById('clearConversation');
    const statusIndicator = document.getElementById('statusIndicator');
    const statusText = document.getElementById('statusText');
    const conversationContainer = document.getElementById('conversationContainer');
    const audioVisualization = document.getElementById('audioVisualization');
    const audioPlayer = document.getElementById('audioPlayer');
    const textInput = document.getElementById('textInput');
    const sendTextBtn = document.getElementById('sendText');
    const assemblyStatus = document.getElementById('assemblyStatus');
    const llmStatus = document.getElementById('llmStatus');

    const fileUpload = document.getElementById('fileUpload');
    const filePreview = document.getElementById('filePreview');
    const driveUploadBtn = document.getElementById('googleDriveUpload');
    // Global variables
    let recorder;
    let audioContext;
    let audioStream;
    let analyser;
    let canvasContext = audioVisualization.getContext('2d');
    let animationFrame;
    let isRecording = false;
    let socket;
    let conversationHistory = [];

    
    

    // const API_KEY = 'AIzaSyAaRsR5ZXRb_7PRp5ywdqoL0dPe7qd9dy0';
    // const CLIENT_ID = '449782901573-ne41mfn55tt7jr8dn594s8brmoapnjbn.apps.googleusercontent.com';
    const SCOPES = 'https://www.googleapis.com/auth/drive.readonly';
    
    
    
    let gapiInited = false;
    let gisInited = false;
    let accessToken = null;
    let isUserAuthenticated = false;
    let selectedFiles = [];



    // Replace with dynamic loading
let API_KEY = null;
let CLIENT_ID = null;


// Load API keys before initializing Google APIs
async function initializeApp() {
    const config = await loadApiKeys();
    if (config) {
        API_KEY = config.apiKey;
        CLIENT_ID = config.clientId;
        
        // Initialize Google API client
        gapi.load('client:auth2:picker', initializeGapiClient);
    }
}


    let sessionId = generateSessionId();

    function generateSessionId() {
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
    }

    // Add this function to fetch API keys from backend
async function loadApiKeys() {
    try {
        const response = await fetch('/api/config');
        if (!response.ok) {
            throw new Error('Failed to load API configuration');
        }
        const config = await response.json();
        return {
            apiKey: config.google_api_key,
            clientId: config.google_client_id
        };
    } catch (error) {
        console.error('Error loading API keys:', error);
        statusText.textContent = 'Error loading configuration';
        return null;
    }
}
    async function initializeGapiClient() {
        await gapi.client.init({
          apiKey: API_KEY,
          discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"],
        });
        gapiInited = true;
        
        // Initialize the GIS client
        google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: handleCredentialResponse,
        });
        gisInited = true;
        
        // Check if the user was previously authenticated
        try {
          if (localStorage.getItem('googleDriveAuthenticated') === 'true') {
            isUserAuthenticated = true;
          }
        } catch (e) {
          console.warn('Could not access localStorage', e);
        }
      }
      
      function handleCredentialResponse(response) {
        console.log("Google Identity Services credential response:", response);
      }
      
      function handleDriveUpload() {
        if (!gapiInited || !gisInited) {
          console.log('Google Drive integration is initializing. Please try again.');
          return;
        }
        
        // If user is already authenticated, go directly to Drive picker
        if (isUserAuthenticated && accessToken) {
          loadDriveAPI();
          return;
        }
        
        // Use the Google Sign-In API for authentication
        const tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: SCOPES,
          callback: (tokenResponse) => {
            if (tokenResponse && tokenResponse.access_token) {
              accessToken = tokenResponse.access_token;
              isUserAuthenticated = true;
              
              // Store authentication state in localStorage (optional)
              try {
                localStorage.setItem('googleDriveAuthenticated', 'true');
              } catch (e) {
                console.warn('Could not store auth state in localStorage', e);
              }
              
              loadDriveAPI();
            }
          },
          error_callback: (error) => {
            console.error('Google authentication error:', error);
          }
        });
        
        // Request an access token
        tokenClient.requestAccessToken({
          prompt: isUserAuthenticated ? '' : 'consent', // Skip consent prompt if already authenticated
        });
      }
      
      function loadDriveAPI() {
        // Check if the picker API is loaded
        if (!window.google || !window.google.picker) {
          // Load the picker API
          gapi.load('picker', {
            callback: createPicker,
            onerror: function() {
              console.error('Failed to load Google Picker API.');
            }
          });
        } else {
          createPicker();
        }
      }
      
      function createPicker() {
        try {
          // Create the picker and display it
          const view = new google.picker.View(google.picker.ViewId.DOCS);
          const picker = new google.picker.PickerBuilder()
            .enableFeature(google.picker.Feature.NAV_HIDDEN)
            .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
            .setOAuthToken(accessToken)
            .addView(view)
            .addView(new google.picker.DocsUploadView())
            .setDeveloperKey(API_KEY)
            .setCallback(pickerCallback)
            .build();
          picker.setVisible(true);
        } catch (error) {
          console.error("Error creating picker:", error);
          
          // If there's an authentication issue, reset auth state
          if (error.message && (
              error.message.includes('authentication') || 
              error.message.includes('token') || 
              error.message.includes('auth'))) {
            isUserAuthenticated = false;
            accessToken = null;
            try {
              localStorage.removeItem('googleDriveAuthenticated');
            } catch (e) {}
          }
        }
      }
      
      function pickerCallback(data) {
        if (data[google.picker.Response.ACTION] === google.picker.Action.PICKED) {
          const docs = data[google.picker.Response.DOCUMENTS];
          
          // Reset selected files
          selectedFiles = [];
          
          docs.forEach(doc => {
            const fileInfo = {
              id: doc.id,
              name: doc.name,
              size: doc.sizeBytes || 0,
              mimeType: doc.mimeType
            };
            
            selectedFiles.push(fileInfo);
            
          });
          
          // Automatically upload files to backend
          if (selectedFiles.length > 0) {
            sendFilesToBackend();
          }
          
        } else if (data[google.picker.Response.ACTION] === google.picker.Action.CANCEL) {
          console.log('User canceled the picker');
        } else if (data[google.picker.Response.ACTION] === google.picker.Action.ERROR) {
          console.error('Picker error:', data[google.picker.Response.ERROR]);
          
          // Reset authentication if needed
          if (data[google.picker.Response.ERROR].includes('auth') || 
              data[google.picker.Response.ERROR].includes('token')) {
            isUserAuthenticated = false;
            accessToken = null;
            try {
              localStorage.removeItem('googleDriveAuthenticated');
            } catch (e) {}
          }
        }
      }
      
      async function sendFilesToBackend() {
        if (selectedFiles.length === 0) {
            console.log('No files selected for upload');
            return;
        }
        let fileNames = ''
        statusText.textContent = 'Fetching files from Google Drive...';
        
        try {
            const formData = new FormData();
            formData.append('session_id', sessionId);
    
            let processedFiles = [];
    
            for (let i = 0; i < selectedFiles.length; i++) {
                const file = selectedFiles[i];
    
                statusText.textContent = `Downloading file: ${file.name}...`;
                
                const allowedMimeTypes = [
                    'text/x-c', 'text/x-c++', 'text/x-csharp', 'text/css', 
                    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 
                    'text/x-golang', 'text/html', 'text/x-java', 'text/javascript', 
                    'application/json', 'text/markdown', 'application/pdf', 
                    'text/x-php', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 
                    'text/x-python', 'text/x-script.python', 'text/x-ruby', 
                    'application/x-sh', 'text/x-tex', 'application/typescript', 
                    'text/plain'
                  ];
                  if (!allowedMimeTypes.includes(file.mimeType)) {
                    console.log(`Skipping file ${file.name} due to unsupported MIME type.`);
                    // Show unsupported file message in UI
                    const message = `Unsupported file type: ${file.name}. \n\nOnly the following file types are supported: \n.c, .cpp, .cs, .css, .doc, .docx, .go, .html, .java, .js, .json, .md, .pdf, .php, .pptx, .py, .rb, .sh, .tex, .ts, .txt`;
                    addMessageToConversation('system', message);
                    continue;
                  }
                // Get actual file content from Google Drive
                const response = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
                    headers: { Authorization: `Bearer ${accessToken}` }
                });
                
                fileNames += file.name + ', ';
                if (!response.ok) {
                    console.error(`Failed to fetch content for ${file.name}`);
                    continue;
                }
                
                console.log(response)
                // Convert response to Blob
                const blob = await response.blob();
                console.log(blob)
                // Compute hash of the file
                const fileHash = await computeFileHash(blob);
                
                // Convert Blob to File (necessary for FormData)
                const fileObject = new File([blob], file.name, { type: file.mimeType });
                console.log(`Fixed File: ${fileObject.name}, Size: ${fileObject.size}, Type: ${fileObject.type}`);
                // Add file to FormData
                formData.append('files', fileObject);
    
                // Store processed file with hash for display
                processedFiles.push({ file: fileObject, hash: fileHash });
            }
    
            statusText.textContent = 'Uploading file...';
    
            // Send to backend
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
    
            if (!response.ok) {
                throw new Error('File upload failed');
            }
    
            const result = await response.json();
            
            // Pass the processed files to displayFiles
            displayFiles(processedFiles);
    
            fileNames = fileNames.slice(0, -2);
            const message = `Files uploaded: ${fileNames}`;
            addMessageToConversation('system', message);
            
            // Reset status
            statusText.textContent = 'Files uploaded successfully';
            
            // Clear the file input to allow uploading the same file again
            fileUpload.value = '';
    
        } catch (error) {
            console.error('Error uploading files:', error);
            statusText.textContent =  error.message;
          
          // Clear the file input
            fileUpload.value = '';
        }
    }
    
async function computeFileHash(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsArrayBuffer(blob);
            reader.onloadend = async function () {
                const hashBuffer = await crypto.subtle.digest('SHA-256', reader.result);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                const hash = hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('');
                resolve(hash);
            };
            reader.onerror = reject;
        });
    }
    
// Add this function to handle file uploads
async function handleFileUpload(event) {
    const files = event.target.files;
    if (!files || files.length === 0) {
        console.log('No files selected for upload');
        return;
    }
    
    // Show loading state
    statusText.textContent = 'Uploading file...';
    
    // Create FormData to send files
    const formData = new FormData();
    formData.append('session_id', sessionId);
    
    let processedFiles = [];
    let fileNames = '';
    
    const allowedMimeTypes = [
        'text/x-c', 'text/x-c++', 'text/x-csharp', 'text/css', 
        'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 
        'text/x-golang', 'text/html', 'text/x-java', 'text/javascript', 
        'application/json', 'text/markdown', 'application/pdf', 
        'text/x-php', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 
        'text/x-python', 'text/x-script.python', 'text/x-ruby', 
        'application/x-sh', 'text/x-tex', 'application/typescript', 
        'text/plain'
    ];
    
    try {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            console.log(file)
            // Check if file type is allowed
            if (!allowedMimeTypes.includes(file.type)) {
                console.log(`Skipping file ${file.name} due to unsupported MIME type.`);
                // Show unsupported file message in UI
                const message = `Unsupported file type: ${file.name}. \n\nOnly the following file types are supported: \n.c, .cpp, .cs, .css, .doc, .docx, .go, .html, .java, .js, .json, .md, .pdf, .php, .pptx, .py, .rb, .sh, .tex, .ts, .txt`;
                addMessageToConversation('system', message);
                continue;
            }
            
            // Compute hash of the file if needed
            const fileHash = await computeFileHash(file);

            // Add file to FormData
            formData.append('files', file);
            fileNames += file.name + ', ';
            
            // Store processed file for display
            // If hash computation is needed, uncomment above and use the line below
            processedFiles.push({ file: file, hash: fileHash });
            // processedFiles.push({ file: file });
        }
        
        // If no valid files were found
        if (processedFiles.length === 0) {
            statusText.textContent = 'No valid files to upload';
            return;
        }
        
        // Send to backend
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error('File upload failed');
        }
        
        const result = await response.json();
        
        // Display processed files in the preview area
        displayFiles(processedFiles);
        
        // Format file names for message
        fileNames = fileNames.slice(0, -2); // Remove trailing comma and space
        const message = `Files uploaded: ${fileNames}`;
        addMessageToConversation('system', message);
        
        // Reset status
        statusText.textContent = 'Files uploaded successfully';
        
        // Clear the file input to allow uploading the same file again
        fileUpload.value = '';
        
    } catch (error) {
        console.error('Error uploading files:', error);
        statusText.textContent = error.message;
        
        // Clear the file input
        fileUpload.value = '';
    }
}

// New display files function
function displayFiles(files) {
    files.forEach(({ file, hash }) => {
        const fileItem = document.createElement('div');
        fileItem.classList.add('file-item');

        const fileName = document.createElement('span');
        fileName.textContent = file.name;

        // Store filename and hash as data attributes
        fileItem.dataset.filename = file.name;
        fileItem.dataset.fileHash = hash;

        // Add delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.classList.add('delete-file-btn');
        deleteBtn.innerHTML = '&times;';
        deleteBtn.onclick = async function () {
            try {
                const response = await fetch(`/api/delete-file?filename=${encodeURIComponent(file.name)}&file_hash=${hash}&session_id=${sessionId}`, {
                    method: 'DELETE'
                });

                if (!response.ok) {
                    throw new Error('Failed to delete file', );
                }
                addMessageToConversation('system','Deleted ' + file.name  + 'from knowledeg Base')
                fileItem.remove(); // Remove from UI
            } catch (error) {
                console.error('Error deleting file:', error);
            }
        };

        fileItem.appendChild(fileName);
        fileItem.appendChild(deleteBtn);
        filePreview.appendChild(fileItem);
    });
}


    // Add a function to extend the message system to include 'system' messages
    function addMessageToConversation(role, text) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message');
        
        if (role === 'user') {
            messageDiv.classList.add('user-message');
        } else if (role === 'assistant') {
            messageDiv.classList.add('assistant-message');
        } else if (role === 'system') {
            messageDiv.classList.add('system-message');
        }
        
        messageDiv.textContent = text;
        
        conversationContainer.appendChild(messageDiv);
        conversationContainer.scrollTop = conversationContainer.scrollHeight;
}

// Add this event listener to the initialization section

    // Connect to WebSocket
    function connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        
        socket = new WebSocket(wsUrl);
        
        socket.onopen = () => {
            console.log('WebSocket connection established');
        };
        
        socket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            
            switch (message.type) {
                case 'transcription':
                    addMessageToConversation('user', message.text);
                    addToConversationHistory('user', message.text);
                    statusText.textContent = 'Getting response...';
                    break;
                    
                case 'llm_response':
                    addMessageToConversation('assistant', message.text);
                    addToConversationHistory('assistant', message.text);
                    statusText.textContent = 'Generating speech...';
                    break;
                    
                case 'tts':
                    playAudio(message.audio_data);
                    statusText.textContent = 'Not recording';
                    break;
                    
                case 'error':
                        console.error('Server error:', message.error);
                        statusText.textContent = 'Error: ' + message.error;
                    
                    break;
                    
                default:
                    console.warn('Unknown message type:', message.type);
            }
        };
        
        socket.onclose = () => {
            console.log('WebSocket connection closed');
            // Try to reconnect after a delay
            setTimeout(connectWebSocket, 3000);
        };
        
        socket.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    }

    // Initialize audio context and setup
    function initAudio() {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Setup canvas for visualization
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
    }

    // Resize canvas to fit container
    function resizeCanvas() {
        audioVisualization.width = audioVisualization.offsetWidth;
        audioVisualization.height = audioVisualization.offsetHeight;
    }

    // Start recording audio
    async function startRecording() {
        try {
            audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            // Setup analyser for visualization
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            const source = audioContext.createMediaStreamSource(audioStream);
            source.connect(analyser);
            
            // Create recorder
            recorder = new RecordRTC(audioStream, {
                type: 'audio',
                mimeType: 'audio/webm',
                recorderType: RecordRTC.StereoAudioRecorder,
                numberOfAudioChannels: 1,
                sampleRate: 44100,
                desiredSampRate: 16000 // Better for speech recognition
            });
            
            // Start recording
            recorder.startRecording();
            isRecording = true;
            
            // Update UI
            startRecordingBtn.disabled = true;
            stopRecordingBtn.disabled = false;
            statusIndicator.classList.add('recording');
            statusText.textContent = 'Recording...';
            
            // Start visualization
            visualize();
            
        } catch (error) {
            console.error('Error starting recording:', error);
            alert('Could not access microphone. Please ensure you have given permission.');
        }
    }

    // Stop recording and process audio
    function stopRecording() {
        if (!recorder) return;
        
        recorder.stopRecording(() => {
            // Get recorded blob
            const audioBlob = recorder.getBlob();
            
            // Stop tracks from stream
            audioStream.getTracks().forEach(track => track.stop());
            
            // Update UI
            isRecording = false;
            startRecordingBtn.disabled = false;
            stopRecordingBtn.disabled = true;
            statusIndicator.classList.remove('recording');
            statusText.textContent = 'Processing...';
            
            // Cancel visualization
            cancelAnimationFrame(animationFrame);
            
            // Process the audio - either via WebSocket or REST API
            processAudio(audioBlob);
        });
    }

    // Process recorded audio
    function processAudio(audioBlob) {
        // Convert blob to base64
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = function() {
            const base64data = reader.result.split(',')[1];
            
            if (socket && socket.readyState === WebSocket.OPEN) {
                // Send via WebSocket
                socket.send(JSON.stringify({
                    type: 'audio',
                    audio_data: base64data,
                    conversation_history: conversationHistory,
                    session_id: sessionId
                }));
            } else {
                // Fallback to REST API if WebSocket is not available
                processAudioViaRESTAPI(base64data);
            }
        };
    }

    // Process audio using the REST API endpoints
    async function processAudioViaRESTAPI(base64data) {
        try {
            // Step 1: Transcribe audio
            statusText.textContent = 'Transcribing...';
            const transcriptionResponse = await fetch('/api/transcribe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    audio_data: base64data
                })
            });
            
            if (!transcriptionResponse.ok) {
                if (transcriptionResponse.status === 401) {
                    statusText.textContent = 'Error: Credits over';
                } else {
                    statusText.textContent = 'Error: Transcription failed';
                }
                return;
            }
            
            const transcriptionData = await transcriptionResponse.json();
            const transcribedText = transcriptionData.text;
            
            // Add user message to conversation
            addMessageToConversation('user', transcribedText);
            addToConversationHistory('user', transcribedText);
            
            // Step 2: Get LLM response
            statusText.textContent = 'Getting response...';
            const llmResponse = await fetch('/api/llm', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: transcribedText,
                    session_id: sessionId ,
                    // conversation_history: conversationHistory,
                })
            });
            
            if (!llmResponse.ok) {
                if (llmResponse.status === 401) {
                    statusText.textContent = 'Error: Credits over';
                } else {
                    statusText.textContent = 'Error: LLM request failed';
                }
                return;
            }
            
            const llmData = await llmResponse.json();
            const assistantResponse = llmData.response;
            
            // Add assistant message to conversation
            addMessageToConversation('assistant', assistantResponse);
            addToConversationHistory('assistant', assistantResponse);
            
            // Step 3: Convert response to speech
            statusText.textContent = 'Generating speech...';
            const response = await fetch('/api/tts/stream', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: assistantResponse
                })
            });
            
            if (!response.ok) {
                if (response.status === 401) {
                    statusText.textContent = 'Error: Credits over';
                } else {
                    statusText.textContent = 'Error: TTS request failed';
                }
                return;
            }
            
            // Create a blob URL from the stream
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            
            // Set the audio source to the blob URL
            audioPlayer.src = url;
            audioPlayer.play();
            
            // Update status
            audioPlayer.onplay = () => {
                statusText.textContent = 'Playing audio...';
            };
            
            audioPlayer.onended = () => {
                statusText.textContent = 'Not recording';
                URL.revokeObjectURL(url); // Clean up the blob URL
            };
        } catch (error) {
            console.error('Error in streaming audio:', error);
        }
    }

    // Audio visualization
    function visualize() {
        if (!isRecording) return;
        
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);
        
        // Clear canvas
        canvasContext.clearRect(0, 0, audioVisualization.width, audioVisualization.height);
        
        // Draw visualization
        const barWidth = (audioVisualization.width / bufferLength) * 2.5;
        let x = 0;
        
        for (let i = 0; i < bufferLength; i++) {
            const barHeight = dataArray[i] / 2;
            
            canvasContext.fillStyle = `rgb(${barHeight + 100}, 156, 255)`;
            canvasContext.fillRect(x, audioVisualization.height - barHeight, barWidth, barHeight);
            
            x += barWidth + 1;
        }
        
        animationFrame = requestAnimationFrame(visualize);
    }

    // Add message to conversation UI
    function addMessageToConversation(role, text) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message');
        messageDiv.classList.add(role === 'user' ? 'user-message' : 'assistant-message');
        messageDiv.textContent = text;
        
        conversationContainer.appendChild(messageDiv);
        conversationContainer.scrollTop = conversationContainer.scrollHeight;
    }

    // Add message to conversation history
    function addToConversationHistory(role, content) {
        conversationHistory.push({ role, content });
    }

    // Play audio from base64 string
    function playAudio(base64Audio) {
        const audioSrc = 'data:audio/mp3;base64,' + base64Audio;
        audioPlayer.src = audioSrc;
        audioPlayer.play();
    }

    // Send text message
    function sendTextMessage() {
        const text = textInput.value.trim();
        if (!text) return;
        
        // Add message to conversation
        addMessageToConversation('user', text);
        addToConversationHistory('user', text);
        
        // Update status
        statusText.textContent = 'Processing...';
        
        // Send to backend
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'text',
                message: text,
                conversation_history: conversationHistory,
                session_id: sessionId
            }));
        } else {
            // Use REST API
            sendMessageViaRESTAPI(text);
        }
        
        // Clear input
        textInput.value = '';
    }
    
    // Fixed sendMessageViaRESTAPI function
    async function sendMessageViaRESTAPI(text) {
        try {
            // Update status
            statusText.textContent = 'Getting response...';
            
            // Get LLM response
            const llmResponse = await fetch('/api/llm', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: text,
                    session_id: sessionId,
                    // conversation_history: conversationHistory,
                })
            });
            
            if (!llmResponse.ok) {
                throw new Error('LLM request failed');
            }
            
            const llmData = await llmResponse.json();
            const assistantResponse = llmData.response;
            
            // Add assistant message to conversation
            addMessageToConversation('assistant', assistantResponse);
            addToConversationHistory('assistant', assistantResponse);
            
            statusText.textContent = 'Generating speech...';
        // Create a ReadableStream URL
            const response = await fetch('/api/tts/stream', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text: assistantResponse
            })
        });
        
        if (!response.ok) {
            console.log(response)
            if (response.status === 401) {
                statusText.textContent = 'Error: Credits over';
            } else {
                statusText.textContent = 'Error: TTS request failed';
            }
            return;
        }
        
        // Create a blob URL from the stream
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        
        // Set the audio source to the blob URL
        audioPlayer.src = url;
        audioPlayer.play();
        
        // Update status
        audioPlayer.onplay = () => {
            statusText.textContent = 'Playing audio...';
        };
        
        audioPlayer.onended = () => {
            statusText.textContent = 'Not recording';
            URL.revokeObjectURL(url); // Clean up the blob URL
        };
    } catch (error) {
        console.error('Error in streaming audio:', error);
        statusText.textContent = 'Error: ' + error.message;
    }
}
    function resetSession() {
        sessionId = generateSessionId();
        conversationHistory = [];
        conversationContainer.innerHTML = '';
}
    // Clear conversation
    function clearConversation() {
        conversationContainer.innerHTML = '';
        conversationHistory = [];
        selectedFiles = [];
        filePreview.innerHTML = ''; // Clear file preview
        resetSession();
        statusText.textContent = 'Session reset. Ready to record.'
    }
    

    // Check API status
    async function checkAPIStatus() {
        try {
            // Check AssemblyAI
            const assemblyResponse = await fetch('/api/status/assembly', { method: 'GET' })
                .catch(() => ({ ok: false }));
            
            if (assemblyResponse.ok) {
                assemblyStatus.textContent = 'AssemblyAI: Connected';
                assemblyStatus.classList.add('status-connected');
            } else {
                assemblyStatus.textContent = 'AssemblyAI: Not connected';
                assemblyStatus.classList.add('status-error');
            }
            
            // Check LLM API
            const llmResponse = await fetch('/api/status/llm', { method: 'GET' })
                .catch(() => ({ ok: false }));
            
            if (llmResponse.ok) {
                llmStatus.textContent = 'LLM API: Connected';
                llmStatus.classList.add('status-connected');
            } else {
                llmStatus.textContent = 'LLM API: Not connected';
                llmStatus.classList.add('status-error');
            }
            
        } catch (error) {
            console.error('Error checking API status:', error);
            
            // Set status as error
            assemblyStatus.textContent = 'AssemblyAI: Error checking status';
            assemblyStatus.classList.add('status-error');
            
            llmStatus.textContent = 'LLM API: Error checking status';
            llmStatus.classList.add('status-error');
        }
    }

    
    // Event listeners
    startRecordingBtn.addEventListener('click', startRecording);
    stopRecordingBtn.addEventListener('click', stopRecording);
    driveUploadBtn.addEventListener('click', handleDriveUpload);
    clearConversationBtn.addEventListener('click', clearConversation);
    fileUpload.addEventListener('change', function(event) {
        event.stopPropagation(); // Prevent event from bubbling up
        handleFileUpload(event);
    });
    
    sendTextBtn.addEventListener('click', sendTextMessage);
    textInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendTextMessage();
        }
    });

 
        // Your existing initialization code...
        initializeApp();
        initAudio();
        connectWebSocket();

        
        // Initialize Google Drive API
        // initGoogleDriveAPI();
   
    // Initialize
    
    
    // Since we don't have status endpoints yet, let's set a fallback
    // In a real app, you'd want to implement these endpoints
    // try {
    //     checkAPIStatus();
    // } catch (e) {
    //     assemblyStatus.textContent = 'AssemblyAI: Status unknown';
    //     llmStatus.textContent = 'LLM API: Status unknown';
    // }
});