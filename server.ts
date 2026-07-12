import app from './api/index.js';
import 'dotenv/config';


const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🚀 Local dev server running on http://localhost:${PORT}`);
});