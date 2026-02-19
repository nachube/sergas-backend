require("dotenv").config();

const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const app = express();
app.use(cors());
app.use(express.json());

/* ================= MYSQL ================= */

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
});

/* ================= LOGIN ================= */

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;

  db.query("SELECT * FROM users WHERE email=?", [email], (err, rows) => {
    if (!rows.length) return res.status(401).json({ error: "Usuario no existe" });

    const user = rows[0];
    if (!bcrypt.compareSync(password, user.password))
      return res.status(401).json({ error: "Password incorrecto" });

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET);
    res.json({ token, user });
  });
});

/* ================= PROYECTOS ================= */

app.get("/api/proyectos", (req, res) => {
  db.query("SELECT * FROM proyectos ORDER BY orden", (err, rows) => {
    const parsed = rows.map(p => ({
      ...p,
      tags: p.tags ? JSON.parse(p.tags) : [],
      galeria: p.galeria ? JSON.parse(p.galeria) : [],
      documentos: p.documentos ? JSON.parse(p.documentos) : [],
    }));
    res.json(parsed);
  });
});

app.post("/api/proyectos", (req, res) => {
  const data = {
    ...req.body,
    tags: JSON.stringify(req.body.tags || []),
    galeria: JSON.stringify(req.body.galeria || []),
    documentos: JSON.stringify(req.body.documentos || []),
  };

  db.query("INSERT INTO proyectos SET ?", data, () => res.send("OK"));
});

app.put("/api/proyectos/:id", (req, res) => {
  const id = req.params.id;
  const data = { ...req.body };

  if (data.tags) data.tags = JSON.stringify(data.tags);
  if (data.galeria) data.galeria = JSON.stringify(data.galeria);
  if (data.documentos) data.documentos = JSON.stringify(data.documentos);

  db.query("UPDATE proyectos SET ? WHERE id=?", [data, id], () => res.send("OK"));
});

app.delete("/api/proyectos/:id", (req, res) => {
  db.query("DELETE FROM proyectos WHERE id=?", [req.params.id], () => res.send("OK"));
});

/* ===== REORDENAR PROYECTOS ===== */

app.post("/api/proyectos/reordenar", (req, res) => {
  const ids = req.body.ids;

  ids.forEach((id, index) => {
    db.query("UPDATE proyectos SET orden=? WHERE id=?", [index, id]);
  });

  res.send("OK");
});

/* ===== PUBLICOS ===== */

app.get("/api/proyectos-home", (req, res) => {
  db.query(
    "SELECT * FROM proyectos WHERE visible=1 AND visibilidad LIKE '%home%' ORDER BY orden",
    (err, rows) => res.json(rows)
  );
});

app.get("/api/proyectos-publicos", (req, res) => {
  db.query(
    "SELECT * FROM proyectos WHERE visible=1 AND visibilidad LIKE '%proyectos%' ORDER BY orden",
    (err, rows) => res.json(rows)
  );
});

/* ================= TIPOS OBRA ================= */

app.get("/api/tipos-obra", (req, res) => {
  db.query("SELECT * FROM tipos_obra ORDER BY orden", (err, rows) => res.json(rows));
});

app.post("/api/tipos-obra/reordenar", (req, res) => {
  req.body.ids.forEach((id, index) => {
    db.query("UPDATE tipos_obra SET orden=? WHERE id=?", [index, id]);
  });
  res.send("OK");
});

/* ================= ESTADISTICAS ================= */

app.get("/api/estadisticas", (req, res) => {
  db.query("SELECT * FROM estadisticas ORDER BY orden", (err, rows) => res.json(rows));
});

app.post("/api/estadisticas/reordenar", (req, res) => {
  req.body.ids.forEach((id, index) => {
    db.query("UPDATE estadisticas SET orden=? WHERE id=?", [index, id]);
  });
  res.send("OK");
});

/* ================= UPLOAD ================= */

const storage = multer.memoryStorage();
const upload = multer({ storage });

app.post("/api/upload", upload.single("file"), async (req, res) => {
  const result = await new Promise((resolve) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "sergas" },
      (_, result) => resolve(result)
    );
    stream.end(req.file.buffer);
  });

  res.json({ url: result.secure_url });
});

/* ================= START ================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Backend OK"));