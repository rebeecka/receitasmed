import { Schema, model, Types } from "mongoose";
const PrescriptionSchema = new Schema({
  patientId: { type: String, required: true },
  documentId: { type: Types.ObjectId, ref: "Document", required: true },
  aiResult: Schema.Types.Mixed,
  createdAt: Date,
});
export default model("Prescription", PrescriptionSchema);