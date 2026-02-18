require("dotenv").config();

const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const ftp = require("basic-ftp");
const { Readable } = require("stream");

const app = express();
app.use(cors());
app.use(express.json());

/* ========================= MYSQL ========================= */

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10
});

/* ========================= TEST ========================= */

app.get("/api/ping", (req, res) => {
  res.send("OK");
});

/* ========================= LOGIN ========================= */

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;

  db.query("SELECT * FROM users WHERE email=?", [email], (err, rows) => {
    if (err) return res.status(500).json({ error: "Error DB" });
    if (!rows.length) return res.status(401).json({ error: "Usuario no existe" });

    const user = rows[0];

    if (!bcrypt.compareSync(password, user.password))
      return res.status(401).json({ error: "Password incorrecto" });

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        nombre: user.nombre,
        rol: user.rol
      }
    });
  });
});

/* ========================= PROYECTOS ========================= */

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

app.put("/api/proyectos/:id", (req, res) => {
  const data = {
    ...req.body,
    tags: JSON.stringify(req.body.tags || []),
    galeria: JSON.stringify(req.body.galeria || []),
    documentos: JSON.stringify(req.body.documentos || [])
  };

  db.query("UPDATE proyectos SET ? WHERE id=?", [data, req.params.id], err => {
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

/* ========================= UPLOAD FTP ========================= */

const storage = multer.memoryStorage();
const upload = multer({ storage });

app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    const client = new ftp.Client();

    await client.access({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASSWORD,
      port: parseInt(process.env.FTP_PORT),
    });

    const fileName = Date.now() + "_" + req.file.originalname;

    // SUBIR DIRECTO A RUTA ABSOLUTA
    const remotePath = `/public_html/uploads/${fileName}`;

    await client.uploadFrom(
      Readable.from(req.file.buffer),
      remotePath
    );

    client.close();

    const publicUrl = `https://sergas.ar/uploads/${fileName}`;

    res.json({ url: publicUrl });

  } catch (err) {
    console.error("FTP ERROR:", err);
    res.status(500).json({ error: "Error subiendo archivo" });
  }
});

/* ========================= START ========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => console.log("Backend corriendo en puerto", PORT));