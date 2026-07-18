import express from 'express';
import cors from 'cors'; // 1. Import cors
import authRoutes from '../src/routes/authRoutes.js';

const app = express();

// 2. Enable CORS for all origins (or configure specific ones)
app.use(cors({
    origin: '*', // Allow all origins, or change to your frontend URL like 'http://localhost:5173'
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Wire up your authentication routes
app.use('/api', authRoutes);

// Fallback home route
app.get('/', (_req, res) => {
    res.send('ScrollSaga API is humming along perfectly.');
});

export default app;
