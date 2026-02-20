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



/* =========================================================
   🔴 PARSER ROBUSTO
========================================================= */

function parseProyecto(p, tiposMap = {}) {
  const categoriasIds = p.categoria ? JSON.parse(p.categoria) : [];

  const categoriasSlugs = categoriasIds
    .map(id => tiposMap[id])
    .filter(Boolean);

  return {
    ...p,
    categoria: categoriasSlugs,
    tags: p.tags ? JSON.parse(p.tags) : [],
    galeria: p.galeria ? JSON.parse(p.galeria) : [],
    documentos: p.documentos ? JSON.parse(p.documentos) : []
  };
}



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

app.get("/api/proyectos-listado", (req, res) => {

  db.query("SELECT id, id_categoria FROM tipos_obra", (err, tipos) => {

    const tiposMap = {};
    tipos.forEach(t => tiposMap[t.id] = t.id_categoria);

    db.query(
      "SELECT * FROM proyectos WHERE visible=1 AND visibilidad LIKE '%proyectos%' ORDER BY orden",
      (err, rows) => {
        if (err) return res.json([]);
        res.json(rows.map(p => parseProyecto(p, tiposMap)));
      }
    );

  });

});



/* ================= TIPOS ================= */

app.get("/api/tipos-obra", (req, res) => {
  db.query("SELECT * FROM tipos_obra ORDER BY orden", (err, rows) => {
    if (err) return res.json([]);
    res.json(rows);
  });
});



/* =========================================================
   🔴 ESTADISTICAS — FIX COMPLETO
========================================================= */

app.get("/api/estadisticas", (req, res) => {
  db.query("SELECT * FROM estadisticas_proyecto ORDER BY orden", (err, rows) => {
    if (err) return res.json([]);
    res.json(rows);
  });
});


/* 🔴 CREATE */

app.post("/api/estadisticas", (req, res) => {

  const data = {
    numero: req.body.numero,
    titulo: req.body.titulo,
    descripcion: req.body.descripcion,
    orden: req.body.orden ?? 0,
    activo: req.body.activo ? 1 : 0   // ⭐ FIX CLAVE
  };

  db.query("INSERT INTO estadisticas_proyecto SET ?", data, err => {
    if (err) {
      console.log("ERROR INSERT ESTADISTICA:", err);
      return res.status(500).send("Error insert estadistica");
    }
    res.send("OK");
  });

});


/* 🔴 UPDATE */

app.put("/api/estadisticas/:id", (req, res) => {

  const data = {
    numero: req.body.numero,
    titulo: req.body.titulo,
    descripcion: req.body.descripcion,
    orden: req.body.orden ?? 0,
    activo: req.body.activo ? 1 : 0
  };

  db.query(
    "UPDATE estadisticas_proyecto SET ? WHERE id=?",
    [data, req.params.id],
    err => {
      if (err) return res.status(500).send("Error update estadistica");
      res.send("OK");
    }
  );

});


/* 🔴 DELETE */

app.delete("/api/estadisticas/:id", (req, res) => {
  db.query(
    "DELETE FROM estadisticas_proyecto WHERE id=?",
    [req.params.id],
    err => {
      if (err) return res.status(500).send("Error delete estadistica");
      res.send("OK");
    }
  );
});


/* 🔴 REORDER */

app.post("/api/estadisticas-reordenar", (req, res) => {
  const { orden } = req.body;

  orden.forEach((id, index) => {
    db.query(
      "UPDATE estadisticas_proyecto SET orden=? WHERE id=?",
      [index, id]
    );
  });

  res.json({ ok: true });
});



/* ================= UPLOAD ================= */

const storage = multer.memoryStorage();
const upload = multer({ storage });

app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "sergas" },
        (error, result) => error ? reject(error) : resolve(result)
      );
      stream.end(req.file.buffer);
    });

    res.json({ url: result.secure_url });

  } catch (err) {
    res.status(500).json({ error: "Upload error" });
  }
});



/* ================= START ================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Backend corriendo en puerto", PORT));