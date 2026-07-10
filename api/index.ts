import express from 'express';
import authRoutes from '../src/routes/authRoutes.js';

const app = express();

app.use(express.json());

// Wire up your authentication routes
app.use('/api/auth', authRoutes);

// Fallback home route
app.get('/', (_req, res) => {
    res.send('ScrollSaga API is humming along perfectly.');
});

export default app;