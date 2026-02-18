require("dotenv").config();

const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const ftp = require("basic-ftp");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());

/* =========================
   FTP CONFIG
========================= */

const upload = multer({ dest: "temp/" });

async function subirFTP(localPath, remotePath) {
  const client = new ftp.Client();

  try {
    await client.access({
      host: "147.93.14.113",
      user: "u997842651",
      password: "53rg@5FTP",
      secure: false
    });

    await client.ensureDir(path.dirname(remotePath));
    await client.uploadFrom(localPath, remotePath);

  } finally {
    client.close();
  }
}

/* =========================
   UPLOAD FILES
========================= */

app.post("/api/upload/:tipo", upload.single("file"), async (req, res) => {
  try {
    const tipo = req.params.tipo;
    const file = req.file;

    if (!file) return res.status(400).send("No file");

    const ext = path.extname(file.originalname);
    const nombre = Date.now() + ext;

    const remotePath = `/public_html/uploads/${tipo}/${nombre}`;

    await subirFTP(file.path, remotePath);

    fs.unlinkSync(file.path);

    res.json({
      url: `https://sergas.ar/uploads/${tipo}/${nombre}`
    });

  } catch (err) {
    console.error(err);
    res.status(500).send("Error upload");
  }
});

/* =========================
   MYSQL
========================= */

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
});

db.connect(err => {
  if (err) console.error("MySQL error:", err);
  else console.log("MySQL conectado");
});

/* ========================= LOGIN ========================= */

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;

  db.query("SELECT * FROM users WHERE email=?", [email], (err, rows) => {
    if (err) return res.status(500).send("Error DB");
    if (!rows.length) return res.status(401).send("Usuario no existe");

    const user = rows[0];

    if (!bcrypt.compareSync(password, user.password))
      return res.status(401).send("Password incorrecto");

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET);
    res.json({ token });
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

/* ========================= COMPANY ========================= */

app.get("/api/company", (req, res) => {
  db.query("SELECT * FROM company_data LIMIT 1", (err, rows) => {
    if (err) return res.json(null);
    res.json(rows[0] || null);
  });
});

app.post("/api/company", (req, res) => {
  const data = req.body;

  db.query("SELECT id FROM company_data LIMIT 1", (err, rows) => {
    if (rows.length) {
      db.query("UPDATE company_data SET ? WHERE id=?", [data, rows[0].id], () => res.send("OK"));
    } else {
      db.query("INSERT INTO company_data SET ?", data, () => res.send("OK"));
    }
  });
});

/* ========================= KNOWLEDGE ========================= */

app.get("/api/assistant-knowledge", (req, res) => {
  db.query("SELECT * FROM assistant_knowledge ORDER BY orden DESC", (err, rows) => {
    if (err) return res.json([]);
    res.json(rows || []);
  });
});

/* ========================= USERS ========================= */

app.get("/api/users", (req, res) => {
  db.query("SELECT * FROM users", (err, rows) => {
    if (err) return res.json([]);

    rows.forEach(u => {
      u.permisos = u.permisos ? JSON.parse(u.permisos) : {};
    });

    res.json(rows);
  });
});

/* ========================= START ========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => console.log("Backend corriendo en puerto", PORT));
