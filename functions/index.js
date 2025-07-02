const functions = require('firebase-functions');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { OpenAI } = require('openai');

const app = express();
app.use(cors({ origin: true }));

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

app.post('/process-audio', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file' });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    const audioFile = new File([req.file.buffer], req.file.originalname, { 
      type: req.file.mimetype 
    });
    
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1'
    });

    res.json({ success: true, transcript: transcription.text });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

exports.api = functions.runWith({ secrets: ['OPENAI_API_KEY'] }).https.onRequest(app);