import { Schema, model } from "mongoose";
const DocumentSchema = new Schema({
  patientId: { type: String, required: true },
  fileName: String,
  filePath: String,
  textExtracted: String,
  createdAt: Date,
});
export default model("Document", DocumentSchema);