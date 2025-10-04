import mongoose, { Schema, Document } from "mongoose";

export interface IPaciente extends Document {
  name: string;
  birthDate?: Date;
  gender?: string;
  createdAt: Date;
}

const PacienteSchema: Schema = new Schema({
  name: { type: String, required: true },
  birthDate: { type: Date },
  gender: { type: String, enum: ["M", "F", "Outro"] },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model<IPaciente>("Paciente", PacienteSchema, "paciente");
