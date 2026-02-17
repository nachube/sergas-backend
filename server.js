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

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
});

db.connect(err => {
  if (err) console.error("Error MySQL:", err);
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

/* =========================
   PROYECTOS
========================= */

/* LISTAR */
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

/* CREAR */
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

/* ACTUALIZAR */
app.put("/api/proyectos/:id", (req, res) => {
  const data = {
    ...req.body,
    tags: JSON.stringify(req.body.tags || []),
    galeria: JSON.stringify(req.body.galeria || []),
    documentos: JSON.stringify(req.body.documentos || [])
  };

  db.query(
    "UPDATE proyectos SET ? WHERE id=?",
    [data, req.params.id],
    err => {
      if (err) return res.status(500).send("Error update");
      res.send("OK");
    }
  );
});

/* ELIMINAR */
app.delete("/api/proyectos/:id", (req, res) => {
  db.query("DELETE FROM proyectos WHERE id=?", [req.params.id], err => {
    if (err) return res.status(500).send("Error delete");
    res.send("OK");
  });
});

/* ========================= CONTACTO ========================= */

app.post("/api/contacto", (req, res) => {
  db.query("INSERT INTO mensajes_contacto SET ?", req.body, err => {
    if (err) return res.status(500).send("Error contacto");
    res.send("Mensaje guardado");
  });
});

/* ========================= COMPANY DATA ========================= */

app.get("/api/company", (req, res) => {
  db.query("SELECT * FROM company_data LIMIT 1", (err, rows) => {
    if (err) return res.status(500).send(err);
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

app.get("/api/knowledge", (req, res) => {
  db.query("SELECT * FROM assistant_knowledge ORDER BY orden DESC", (err, rows) => {
    if (err) return res.json([]);
    res.json(rows || []);
  });
});

app.post("/api/knowledge", (req, res) => {
  db.query("INSERT INTO assistant_knowledge SET ?", req.body, err => {
    if (err) return res.status(500).send("Error insert");
    res.send("OK");
  });
});

app.put("/api/knowledge/:id", (req, res) => {
  db.query("UPDATE assistant_knowledge SET ? WHERE id=?", [req.body, req.params.id], err => {
    if (err) return res.status(500).send("Error update");
    res.send("OK");
  });
});

app.delete("/api/knowledge/:id", (req, res) => {
  db.query("DELETE FROM assistant_knowledge WHERE id=?", [req.params.id], err => {
    if (err) return res.status(500).send("Error delete");
    res.send("OK");
  });
});

/* ========================= USERS ========================= */

/* LISTAR */
app.get("/api/users", (req, res) => {
  db.query("SELECT * FROM users", (err, rows) => {
    if (err) return res.json([]);
    rows.forEach(u => {
      u.permisos = u.permisos ? JSON.parse(u.permisos) : {};
    });
    res.json(rows);
  });
});

/* CREAR */
app.post("/api/users", async (req, res) => {
  const { email, nombre, password, rol, permisos } = req.body;

  const hash = await bcrypt.hash(password, 10);

  db.query(
    "INSERT INTO users SET ?",
    {
      email,
      nombre,
      password: hash,
      rol,
      permisos: JSON.stringify(permisos),
      activo: 1
    },
    err => {
      if (err) return res.status(500).send("Error create user");
      res.send("OK");
    }
  );
});

/* UPDATE */
app.put("/api/users/:id", (req, res) => {
  const { nombre, rol, permisos } = req.body;

  db.query(
    "UPDATE users SET ? WHERE id=?",
    [
      {
        nombre,
        rol,
        permisos: JSON.stringify(permisos)
      },
      req.params.id
    ],
    err => {
      if (err) return res.status(500).send("Error update user");
      res.send("OK");
    }
  );
});

/* DELETE */
app.delete("/api/users/:id", (req, res) => {
  db.query("DELETE FROM users WHERE id=?", [req.params.id], err => {
    if (err) return res.status(500).send("Error delete user");
    res.send("OK");
  });
});

/* ========================= UPLOAD FILE ========================= */

const multer = require("multer");
const ftp = require("basic-ftp");
const fs = require("fs");
const path = require("path");

const upload = multer({ dest: "tmp/" });

app.post("/api/upload", upload.single("file"), async (req, res) => {
  const client = new ftp.Client();
  client.ftp.verbose = false;

  try {
    const localPath = req.file.path;
    const fileName = Date.now() + "_" + req.file.originalname;

    await client.access({
      host: "147.93.14.113",
      user: "u997842651",
      password: "53rg@5FTP",
      secure: false
    });

    await client.ensureDir("/public_html/uploads");
    await client.uploadFrom(localPath, "/public_html/uploads/" + fileName);

    fs.unlinkSync(localPath);

    res.json({
      url: "https://sergas.ar/uploads/" + fileName
    });

  } catch (err) {
    console.error(err);
    res.status(500).send("Error upload");
  }

  client.close();
});

/* ========================= START ========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => console.log("Backend corriendo en puerto", PORT));