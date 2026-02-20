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

/* ================= TIPOS DE OBRA – CRUD completo ================= */

app.get("/api/tipos-obra", (req, res) => {
  db.query("SELECT * FROM tipos_obra ORDER BY orden", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post("/api/tipos-obra", (req, res) => {
  const { nombre, id_categoria, visible_en_menu = 1, orden } = req.body;
  
  db.query(
    "INSERT INTO tipos_obra (id_categoria, nombre, orden, visible_en_menu) VALUES (?, ?, ?, ?)",
    [id_categoria, nombre, orden || 999, visible_en_menu ? 1 : 0],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: result.insertId, success: true });
    }
  );
});

app.put("/api/tipos-obra/:id", (req, res) => {
  const id = parseInt(req.params.id);
  const updates = req.body;  // { visible_en_menu: ..., nombre: ..., etc. }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "No hay campos para actualizar" });
  }

  let setClause = [];
  let values = [];

  if ('nombre' in updates) {
    setClause.push("nombre = ?");
    values.push(updates.nombre);
  }
  if ('id_categoria' in updates) {
    setClause.push("id_categoria = ?");
    values.push(updates.id_categoria);
  }
  if ('visible_en_menu' in updates) {
    setClause.push("visible_en_menu = ?");
    values.push(updates.visible_en_menu ? 1 : 0);
  }
  // Podés agregar otros campos si aparecen en el futuro

  if (setClause.length === 0) {
    return res.status(400).json({ error: "Ningún campo válido para actualizar" });
  }

  values.push(id);  // el WHERE id = ?

  const query = `UPDATE tipos_obra SET ${setClause.join(", ")} WHERE id = ?`;

  db.query(query, values, (err) => {
    if (err) {
      console.error("Error en UPDATE tipos_obra:", err);
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true });
  });
});

// ──────────────── ESTADISTICAS ────────────────
app.get("/api/estadisticas", (req, res) => {
  db.query("SELECT * FROM estadisticas_proyecto ORDER BY orden ASC", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post("/api/estadisticas", (req, res) => {
  const { numero, titulo, descripcion, activo = 1, orden } = req.body;
  db.query(
    "INSERT INTO estadisticas_proyecto (numero, titulo, descripcion, activo, orden) VALUES (?, ?, ?, ?, ?)",
    [numero, titulo, descripcion, activo ? 1 : 0, orden || 999],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: result.insertId, success: true });
    }
  );
});

app.put("/api/estadisticas/:id", (req, res) => {
  const id = parseInt(req.params.id);
  const updates = req.body;
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "No hay campos para actualizar" });
  }
  let setClause = [];
  let values = [];
  if ('numero' in updates) { setClause.push("numero = ?"); values.push(updates.numero); }
  if ('titulo' in updates) { setClause.push("titulo = ?"); values.push(updates.titulo); }
  if ('descripcion' in updates) { setClause.push("descripcion = ?"); values.push(updates.descripcion); }
  if ('activo' in updates) { setClause.push("activo = ?"); values.push(updates.activo ? 1 : 0); }
  if (setClause.length === 0) return res.status(400).json({ error: "Ningún campo válido" });
  values.push(id);
  const query = `UPDATE estadisticas_proyecto SET ${setClause.join(", ")} WHERE id = ?`;
  db.query(query, values, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.delete("/api/estadisticas/:id", (req, res) => {
  const id = parseInt(req.params.id);
  db.query("DELETE FROM estadisticas_proyecto WHERE id = ?", [id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.post("/api/estadisticas-reordenar", (req, res) => {
  const { orden } = req.body;
  if (!Array.isArray(orden)) return res.status(400).json({ error: "orden debe ser array" });
  db.getConnection((err, conn) => {
    if (err) return res.status(500).json({ error: err.message });
    conn.beginTransaction(err => {
      if (err) { conn.release(); return res.status(500).json({ error: err }); }
      let completed = 0;
      orden.forEach((id, index) => {
        conn.query(
          "UPDATE estadisticas_proyecto SET orden = ? WHERE id = ?",
          [index, id],
          err => {
            if (err) {
              return conn.rollback(() => {
                conn.release();
                res.status(500).json({ error: err.message });
              });
            }
            completed++;
            if (completed === orden.length) {
              conn.commit(err => {
                if (err) {
                  conn.rollback(() => conn.release());
                  return res.status(500).json({ error: err });
                }
                conn.release();
                res.json({ success: true });
              });
            }
          }
        );
      });
    });
  });
});

// Config para máximo visible
app.get("/api/config/estadisticas_max_visible", (req, res) => {
  db.query("SELECT valor FROM config WHERE clave = 'estadisticas_max_visible' LIMIT 1", (err, rows) => {
    if (err || rows.length === 0) return res.json({ max: 6 });
    res.json({ max: parseInt(rows[0].valor) || 6 });
  });
});

app.put("/api/config/estadisticas_max_visible", (req, res) => {
  const { max } = req.body;
  if (!Number.isInteger(max) || max < 1) return res.status(400).json({ error: "max debe ser entero positivo" });
  db.query(
    "INSERT INTO config (clave, valor) VALUES ('estadisticas_max_visible', ?) ON DUPLICATE KEY UPDATE valor = ?",
    [max, max],
    err => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, max });
    }
  );
});

/* ================= START ================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Backend corriendo en puerto", PORT));