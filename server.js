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

/* ========================= MYSQL ========================= */

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

/* ========================= TEST ========================= */

app.get("/api/ping", (req, res) => {
  res.send("OK");
});

/* ========================= LOGIN ========================= */

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;

  db.query("SELECT * FROM users WHERE email=?", [email], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error DB" });
    }

    if (!rows.length) {
      return res.status(401).json({ error: "Usuario no existe" });
    }

    const user = rows[0];

    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: "Password incorrecto" });
    }

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

/* ========================= TIPOS OBRA ========================= */

app.get("/api/tipos-obra", (req, res) => {
  db.query("SELECT * FROM tipos_obra ORDER BY orden", (err, rows) => {
    res.json(rows || []);
  });
});

app.post("/api/tipos-obra", (req, res) => {
  db.query("INSERT INTO tipos_obra SET ?", req.body, err => {
    if (err) return res.status(500).send("Error");
    res.send("OK");
  });
});

/* ========================= ESTADISTICAS ========================= */

app.get("/api/estadisticas", (req, res) => {
  db.query("SELECT * FROM estadisticas_proyecto ORDER BY orden", (err, rows) => {
    res.json(rows || []);
  });
});

app.post("/api/estadisticas", (req, res) => {
  db.query("INSERT INTO estadisticas_proyecto SET ?", req.body, err => {
    if (err) return res.status(500).send("Error");
    res.send("OK");
  });
});

/* ========================= COMPANY ========================= */

app.get("/api/company", (req, res) => {
  db.query("SELECT * FROM company LIMIT 1", (err, rows) => {
    if (err) {
      console.error("Company DB error:", err);
      return res.status(500).send("Error DB");
    }
    res.json(rows[0] || null);
  });
});

app.put("/api/company", (req, res) => {
  db.query("UPDATE company SET ? WHERE id=1", req.body, err => {
    if (err) {
      console.error("Company update error:", err);
      return res.status(500).send("Error update");
    }
    res.send("OK");
  });
});

/* ========================= ASSISTANT ========================= */

app.get("/api/assistant-knowledge", (req, res) => {
  db.query("SELECT * FROM assistant_knowledge ORDER BY orden", (err, rows) => {
    res.json(rows || []);
  });
});

app.post("/api/assistant-knowledge", (req, res) => {
  db.query("INSERT INTO assistant_knowledge SET ?", req.body, err => {
    if (err) return res.status(500).send("Error");
    res.send("OK");
  });
});

/* ========================= USERS ========================= */

app.get("/api/users", (req, res) => {
  db.query("SELECT id,email,role FROM users", (err, rows) => {
    res.json(rows || []);
  });
});

/* ========================= START ========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => console.log("Backend corriendo en puerto", PORT));