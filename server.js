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
   🔴 PARSER ROBUSTO (LA CLAVE DEL BUG)
========================================================= */

function safeParseArray(value) {
  if (!value) return [];

  // ya es array
  if (Array.isArray(value)) return value;

  // número simple tipo 3
  if (typeof value === "number") return [value];

  // string simple tipo "3"
  if (typeof value === "string" && !value.startsWith("[")) {
    return [value];
  }

  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

function parseProyecto(p, tiposMap) {
  const categoriasIds = p.categoria ? JSON.parse(p.categoria) : [];

  // Convertir IDs → slugs
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

app.delete("/api/proyectos/:id", (req, res) => {
  db.query("DELETE FROM proyectos WHERE id=?", [req.params.id], err => {
    if (err) return res.status(500).send("Error delete");
    res.send("OK");
  });
});



/* ================= PUBLICOS ================= */

app.get("/api/proyectos-home", (req, res) => {
  db.query(
    "SELECT * FROM proyectos WHERE visible=1 AND visibilidad LIKE '%home%' ORDER BY orden",
    (err, rows) => {
      if (err) return res.json([]);
      res.json(rows.map(parseProyecto));
    }
  );
});

app.get("/api/proyectos-listado", (req, res) => {

  db.query("SELECT id, id_categoria FROM tipos_obra", (err, tipos) => {

    const tiposMap = {};
    tipos.forEach(t => {
      tiposMap[t.id] = t.id_categoria;
    });

    db.query(
      "SELECT * FROM proyectos WHERE visible=1 AND visibilidad LIKE '%proyectos%' ORDER BY orden",
      (err, rows) => {
        if (err) return res.json([]);

        const parsed = rows.map(p => parseProyecto(p, tiposMap));

        res.json(parsed);
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
    console.error(err);
    res.status(500).json({ error: "Upload error" });
  }
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