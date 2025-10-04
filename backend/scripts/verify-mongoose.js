// scripts/verify-mongoose.js
try {
  const path = require.resolve("mongoose/lib/connectionstate");
  console.log("[verify-mongoose] OK:", path);
  process.exit(0);
} catch (e) {
  console.error("[verify-mongoose] FALHOU: não achei mongoose/lib/connectionstate");
  console.error("Provável cache corrompido. Vamos limpar no build.");
  process.exit(1);
}
