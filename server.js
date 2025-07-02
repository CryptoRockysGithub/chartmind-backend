// ChartMind Secure Backend Server
// This protects patient data and keeps API keys secure

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:8080'],
    credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.static('public')); // Serve static files if you have them

// Serve the HTML file at the root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Create secure temp directory for audio files
const TEMP_DIR = path.join(__dirname, 'temp_audio');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Configure multer for secure file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, TEMP_DIR);
    },
    filename: (req, file, cb) => {
        // Generate secure random filename
        const uniqueId = crypto.randomUUID();
        const timestamp = Date.now();
        const ext = path.extname(file.originalname);
        cb(null, `audio_${timestamp}_${uniqueId}${ext}`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 25 * 1024 * 1024 // 25MB limit
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['audio/mp3', 'audio/mpeg', 'audio/wav', 'audio/m4a', 'audio/x-m4a'];
        const allowedExtensions = ['.mp3', '.wav', '.m4a'];
        
        const isValidType = allowedTypes.includes(file.mimetype);
        const isValidExt = allowedExtensions.some(ext => 
            file.originalname.toLowerCase().endsWith(ext)
        );
        
        if (isValidType || isValidExt) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only MP3, WAV, and M4A files are allowed.'));
        }
    }
});

// Security function to clean up temp files
function cleanupTempFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`🗑️ Cleaned up temp file: ${path.basename(filePath)}`);
        }
    } catch (error) {
        console.error(`❌ Error cleaning up temp file: ${error.message}`);
    }
}

// Scheduled cleanup of old temp files (older than 1 hour)
setInterval(() => {
    try {
        const files = fs.readdirSync(TEMP_DIR);
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        
        files.forEach(file => {
            const filePath = path.join(TEMP_DIR, file);
            const stats = fs.statSync(filePath);
            
            if (stats.mtime.getTime() < oneHourAgo) {
                cleanupTempFile(filePath);
            }
        });
    } catch (error) {
        console.error('Error during scheduled cleanup:', error.message);
    }
}, 15 * 60 * 1000); // Run every 15 minutes

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        message: 'ChartMind secure backend is running'
    });
});

// Transcribe audio endpoint
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
    let tempFilePath = null;
    
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No audio file provided' });
        }

        tempFilePath = req.file.path;
        console.log(`🎤 Processing audio file: ${req.file.filename}`);

        // Verify OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OpenAI API key not configured in .env file');
        }

        // Prepare form data for OpenAI Whisper API
        const FormData = require('form-data');
        const formData = new FormData();
        
        formData.append('file', fs.createReadStream(tempFilePath));
        formData.append('model', 'whisper-1');
        formData.append('response_format', 'json');

        // Call OpenAI Whisper API
        const fetch = require('node-fetch');
        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                ...formData.getHeaders()
            },
            body: formData
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ OpenAI API Error:', errorText);
            throw new Error(`Transcription failed: ${response.status} ${response.statusText}`);
        }

        const transcriptionResult = await response.json();
        
        // Log success (without sensitive data)
        console.log(`✅ Transcription completed successfully for file: ${req.file.filename}`);
        
        res.json({
            transcription: transcriptionResult.text,
            success: true,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Transcription error:', error.message);
        res.status(500).json({ 
            error: 'Failed to transcribe audio',
            details: error.message 
        });
    } finally {
        // Always clean up temp file for security
        if (tempFilePath) {
            setTimeout(() => cleanupTempFile(tempFilePath), 1000);
        }
    }
});

// Generate SOAP note endpoint
app.post('/api/generate-soap', async (req, res) => {
    try {
        const { transcription } = req.body;

        if (!transcription || typeof transcription !== 'string') {
            return res.status(400).json({ error: 'Valid transcription text required' });
        }

        // Verify OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OpenAI API key not configured in .env file');
        }

        console.log('📋 Generating SOAP note from transcription');

        // Construct prompt for SOAP note generation
        const prompt = `Please analyze the following medical encounter transcription and create a structured SOAP note. Respond with a JSON object containing 'subjective', 'objective', 'assessment', and 'plan' fields. Each field should contain relevant medical information extracted from the transcription.

Transcription: "${transcription}"

Please provide a comprehensive SOAP note based on the medical information in the transcription. If any section lacks information from the transcription, note that appropriately.`;

        // Call OpenAI GPT API
        const fetch = require('node-fetch');
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'gpt-4',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a medical assistant that creates SOAP notes from patient encounter transcriptions. Always respond with valid JSON containing subjective, objective, assessment, and plan fields. Be thorough but concise, and maintain medical accuracy.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.3,
                max_tokens: 2000
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ OpenAI SOAP API Error:', errorText);
            throw new Error(`SOAP generation failed: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        const soapText = result.choices[0].message.content;
        
        // Parse SOAP note from response
        let soapNote;
        try {
            soapNote = JSON.parse(soapText);
        } catch (parseError) {
            console.log('⚠️ JSON parsing failed, trying text extraction');
            soapNote = parseSOAPFromText(soapText);
        }

        // Validate SOAP note structure
        const validatedSOAP = {
            subjective: soapNote.subjective || 'No subjective information identified in transcription.',
            objective: soapNote.objective || 'No objective findings documented in transcription.',
            assessment: soapNote.assessment || 'Assessment not clearly identified in transcription.',
            plan: soapNote.plan || 'Treatment plan not specified in transcription.'
        };

        console.log('✅ SOAP note generated successfully');

        res.json({
            soap: validatedSOAP,
            success: true,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ SOAP generation error:', error.message);
        res.status(500).json({ 
            error: 'Failed to generate SOAP note',
            details: error.message 
        });
    }
});

// Helper function to parse SOAP from text when JSON parsing fails
function parseSOAPFromText(text) {
    const sections = {
        subjective: '',
        objective: '',
        assessment: '',
        plan: ''
    };

    const lines = text.split('\n');
    let currentSection = '';

    for (const line of lines) {
        const trimmed = line.trim().toLowerCase();
        if (trimmed.includes('subjective') || trimmed.startsWith('s:')) {
            currentSection = 'subjective';
        } else if (trimmed.includes('objective') || trimmed.startsWith('o:')) {
            currentSection = 'objective';
        } else if (trimmed.includes('assessment') || trimmed.startsWith('a:')) {
            currentSection = 'assessment';
        } else if (trimmed.includes('plan') || trimmed.startsWith('p:')) {
            currentSection = 'plan';
        } else if (currentSection && line.trim()) {
            sections[currentSection] += line.trim() + ' ';
        }
    }

    // Clean up sections
    Object.keys(sections).forEach(key => {
        sections[key] = sections[key].trim() || `No ${key} information identified.`;
    });

    return sections;
}

// Error handling middleware
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large. Maximum size is 25MB.' });
        }
        return res.status(400).json({ error: 'File upload error: ' + error.message });
    }
    
    console.error('❌ Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🧹 Cleaning up temp files before shutdown...');
    try {
        const files = fs.readdirSync(TEMP_DIR);
        files.forEach(file => {
            cleanupTempFile(path.join(TEMP_DIR, file));
        });
    } catch (error) {
        console.error('Error during cleanup:', error.message);
    }
    process.exit(0);
});

// Start server
app.listen(PORT, () => {
    console.log(`🔒 ChartMind Secure Backend running on port ${PORT}`);
    console.log(`📁 Temp directory: ${TEMP_DIR}`);
    console.log(`🌐 Health check: http://localhost:${PORT}/api/health`);
    console.log(`🏠 Frontend available at: http://localhost:${PORT}`);
    console.log(`🔑 OpenAI API configured: ${process.env.OPENAI_API_KEY ? 'Yes ✅' : 'No ❌'}`);
    console.log(`💰 Ready to make money for Dr. Rosenberg's network!`);
});