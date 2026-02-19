require("dotenv").config();

const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;

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
  waitForConnections: true,
  connectionLimit: 10
});

/* ================= HELPER PARSE ================= */

function parseProyecto(p) {
  return {
    ...p,
    categoria: p.categoria
      ? JSON.parse(p.categoria).map(String)   // 🔴 CLAVE
      : [],
    tags: p.tags ? JSON.parse(p.tags).map(String) : [],
    galeria: p.galeria ? JSON.parse(p.galeria) : [],
    documentos: p.documentos ? JSON.parse(p.documentos) : []
  };
}

/* ================= PROYECTOS ================= */

app.get("/api/proyectos", (req, res) => {
  db.query("SELECT * FROM proyectos ORDER BY orden", (err, rows) => {
    if (err) return res.json([]);
    res.json(rows.map(parseProyecto));
  });
});

app.post("/api/proyectos", (req, res) => {
  const data = {
    ...req.body,
    categoria: JSON.stringify(req.body.categoria || []),
    tags: JSON.stringify(req.body.tags || []),
    galeria: JSON.stringify(req.body.galeria || []),
    documentos: JSON.stringify(req.body.documentos || [])
  };

  db.query("INSERT INTO proyectos SET ?", data, err => {
    if (err) return res.status(500).send("Error insert");
    res.send("OK");
  });
});

app.put("/api/proyectos/:id", (req, res) => {
  const id = req.params.id;

  const data = {
    ...req.body,
    categoria: JSON.stringify(req.body.categoria || []),
    tags: JSON.stringify(req.body.tags || []),
    galeria: JSON.stringify(req.body.galeria || []),
    documentos: JSON.stringify(req.body.documentos || [])
  };

  db.query("UPDATE proyectos SET ? WHERE id=?", [data, id], err => {
    if (err) return res.status(500).send("Error update");
    res.send("OK");
  });
});

/* ================= PUBLICOS ================= */

app.get("/api/proyectos-listado", (req, res) => {
  db.query(
    "SELECT * FROM proyectos WHERE visible=1 AND visibilidad LIKE '%proyectos%' ORDER BY orden",
    (err, rows) => {
      if (err) return res.json([]);
      res.json(rows.map(parseProyecto));
    }
  );
});

/* ================= TIPOS OBRA ================= */

app.get("/api/tipos-obra", (req, res) => {
  db.query("SELECT * FROM tipos_obra ORDER BY orden", (err, rows) => {
    if (err) return res.json([]);
    res.json(rows);
  });
});

/* ================= UPLOAD ================= */

const storage = multer.memoryStorage();
const upload = multer({ storage });

app.post("/api/upload", upload.single("file"), async (req, res) => {
  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "sergas" },
      (error, result) => error ? reject(error) : resolve(result)
    );
    stream.end(req.file.buffer);
  });

  res.json({ url: result.secure_url });
});

/* ================= DELETE ================= */

app.post("/api/delete-file", async (req, res) => {
  const parts = req.body.url.split("/");
  const fileName = parts.pop().split(".")[0];
  const publicId = "sergas/" + fileName;

  await cloudinary.uploader.destroy(publicId);
  res.json({ ok: true });
});

/* ================= START ================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Backend corriendo en puerto", PORT));