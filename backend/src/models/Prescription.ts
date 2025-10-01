import mongoose, { Schema, Document } from "mongoose";

export interface IPrescription extends Document {
  patientId: mongoose.Types.ObjectId;
  documentId: mongoose.Types.ObjectId;
  aiResult: {
    diet?: string;
    supplements?: string;
    exercises?: string;
    meditation?: string;
  };
  createdAt: Date;
}

const PrescriptionSchema: Schema = new Schema({
  patientId: { type: Schema.Types.ObjectId, ref: "Paciente", required: true },
  documentId: { type: Schema.Types.ObjectId, ref: "Document", required: true },
  aiResult: { type: Object, required: true },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model<IPrescription>("Prescription", PrescriptionSchema, "prescriptions");
