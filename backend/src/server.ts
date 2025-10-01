import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import uploadRoutes from './routes/uploadRoutes'
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/upload', uploadRoutes);

const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/healthapp';

mongoose.connect(MONGO_URI)
  .then(() => app.listen(PORT, () => console.log(`Server running on port ${PORT}`)))
  .catch((err: unknown) => console.error('Mongo connect error', err));
