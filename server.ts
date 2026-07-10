import app from './api/index.js';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🚀 Local dev server running on http://localhost:${PORT}`);
});