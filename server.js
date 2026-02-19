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
  waitForConnections: true,
  connectionLimit: 10
});

/* ================= LOGIN ================= */

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;

  db.query("SELECT * FROM users WHERE email=?", [email], (err, rows) => {
    if (err) return res.status(500).json({ error: "Error DB" });
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
    if (err) return res.json([]);

    const parsed = rows.map(p => ({
      ...p,
      tags: p.tags ? JSON.parse(p.tags) : [],
      galeria: p.galeria ? JSON.parse(p.galeria) : [],
      documentos: p.documentos ? JSON.parse(p.documentos) : []
    }));

    res.json(parsed);
  });
});

app.post("/api/proyectos", (req, res) => {
  const data = {
    ...req.body,
    tags: JSON.stringify(req.body.tags || []),
    galeria: JSON.stringify(req.body.galeria || []),
    documentos: JSON.stringify(req.body.documentos || [])
  };

  db.query("INSERT INTO proyectos SET ?", data, err => {
    if (err) return res.status(500).send("Error insert");
    res.send("OK");
  });
});

/* 🔴 FIX GUARDADO */

app.put("/api/proyectos/:id", (req, res) => {
  const id = req.params.id;

  const data = { ...req.body };

  data.tags = JSON.stringify(req.body.tags || []);
  data.galeria = JSON.stringify(req.body.galeria || []);
  data.documentos = JSON.stringify(req.body.documentos || []);

  db.query("UPDATE proyectos SET ? WHERE id=?", [data, id], err => {
    if (err) return res.status(500).send("Error update");
    res.send("OK");
  });
});

app.delete("/api/proyectos/:id", (req, res) => {
  db.query("DELETE FROM proyectos WHERE id=?", [req.params.id], err => {
    if (err) return res.status(500).send("Error delete");
    res.send("OK");
  });
});

/* ================= REORDENAR PROYECTOS ================= */

app.post("/api/proyectos-reordenar", (req, res) => {
  const { orden } = req.body;

  orden.forEach((id, index) => {
    db.query("UPDATE proyectos SET orden=? WHERE id=?", [index, id]);
  });

  res.json({ ok: true });
});

/* ================= PUBLICOS ================= */

app.get("/api/proyectos-home", (req, res) => {
  db.query(
    "SELECT * FROM proyectos WHERE visible=1 AND visibilidad LIKE '%home%' ORDER BY orden",
    (err, rows) => {
      if (err) return res.json([]);

      const parsed = rows.map(p => ({
        ...p,
        tags: p.tags ? JSON.parse(p.tags) : [],
        galeria: p.galeria ? JSON.parse(p.galeria) : [],
        documentos: p.documentos ? JSON.parse(p.documentos) : []
      }));

      res.json(parsed);
    }
  );
});

app.get("/api/proyectos-listado", (req, res) => {
  db.query(
    "SELECT * FROM proyectos WHERE visible=1 AND visibilidad LIKE '%proyectos%' ORDER BY orden",
    (err, rows) => {
      if (err) return res.json([]);

      const parsed = rows.map(p => ({
        ...p,
        tags: p.tags ? JSON.parse(p.tags) : [],
        galeria: p.galeria ? JSON.parse(p.galeria) : [],
        documentos: p.documentos ? JSON.parse(p.documentos) : []
      }));

      res.json(parsed);
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

/* 🔴 REORDENAR TIPOS */

app.post("/api/tipos-obra-reordenar", (req, res) => {
  const { orden } = req.body;

  orden.forEach((id, index) => {
    db.query("UPDATE tipos_obra SET orden=? WHERE id=?", [index, id]);
  });

  res.json({ ok: true });
});

/* ================= ESTADISTICAS ================= */

app.get("/api/estadisticas", (req, res) => {
  db.query("SELECT * FROM estadisticas_proyecto ORDER BY orden", (err, rows) => {
    if (err) return res.json([]);
    res.json(rows);
  });
});

/* 🔴 REORDENAR ESTADISTICAS */

app.post("/api/estadisticas-reordenar", (req, res) => {
  const { orden } = req.body;

  orden.forEach((id, index) => {
    db.query("UPDATE estadisticas_proyecto SET orden=? WHERE id=?", [index, id]);
  });

  res.json({ ok: true });
});

/* ========================= UPLOAD CLOUDINARY ========================= */

const storage = multer.memoryStorage();
const upload = multer({ storage });

app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "sergas" },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );

      stream.end(req.file.buffer);
    });

    res.json({ url: result.secure_url });

  } catch (err) {
    console.error("CLOUDINARY ERROR:", err);
    res.status(500).json({ error: "Error subiendo archivo" });
  }
});

/* ================= DELETE CLOUDINARY ================= */

app.post("/api/delete-file", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "No URL" });

    const parts = url.split("/");
    const fileName = parts.pop().split(".")[0];
    const publicId = "sergas/" + fileName;

    await cloudinary.uploader.destroy(publicId);

    res.json({ ok: true });

  } catch (err) {
    console.error("DELETE CLOUDINARY ERROR:", err);
    res.status(500).json({ error: "Error eliminando archivo" });
  }
});

/* ================= START ================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => console.log("Backend corriendo en puerto", PORT));