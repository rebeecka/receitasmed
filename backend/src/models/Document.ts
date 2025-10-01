import mongoose, { Schema, Document } from "mongoose";

export interface IDocument extends Document {
  patientId: mongoose.Types.ObjectId;
  fileName: string;
  filePath: string;
  textExtracted?: string;
  createdAt: Date;
}

const DocumentSchema: Schema = new Schema({
  patientId: { type: Schema.Types.ObjectId, ref: "Paciente", required: true },
  fileName: { type: String, required: true },
  filePath: { type: String, required: true },
  textExtracted: { type: String },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model<IDocument>("Document", DocumentSchema, "documents");
