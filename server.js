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
   PARSER ROBUSTO (LA CLAVE DEL BUG)
========================================================= */
function safeParseArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "number") return [value];
  if (typeof value === "string" && !value.startsWith("[")) return [value];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

function parseProyecto(p, tiposMap) {
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
    tipos.forEach(t => tiposMap[t.id] = t.id_categoria);
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

/* ================= TIPOS DE OBRA ================= */
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
  const updates = req.body;
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No hay campos" });

  let setClause = [];
  let values = [];

  if ('nombre' in updates) { setClause.push("nombre = ?"); values.push(updates.nombre); }
  if ('id_categoria' in updates) { setClause.push("id_categoria = ?"); values.push(updates.id_categoria); }
  if ('visible_en_menu' in updates) { setClause.push("visible_en_menu = ?"); values.push(updates.visible_en_menu ? 1 : 0); }

  if (setClause.length === 0) return res.status(400).json({ error: "Ningún campo válido" });

  values.push(id);
  const query = `UPDATE tipos_obra SET ${setClause.join(", ")} WHERE id = ?`;

  db.query(query, values, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.post("/api/tipos-obra-reordenar", (req, res) => {
  const { orden } = req.body;
  if (!Array.isArray(orden)) return res.status(400).json({ error: "orden debe ser array" });

  db.getConnection((err, conn) => {
    if (err) return res.status(500).json({ error: err.message });
    conn.beginTransaction(err => {
      if (err) { conn.release(); return res.status(500).json({ error: err }); }

      let completed = 0;
      orden.forEach((id, index) => {
        conn.query(
          "UPDATE tipos_obra SET orden = ? WHERE id = ?",
          [index, id],
          err => {
            if (err) return conn.rollback(() => { conn.release(); res.status(500).json({ error: err.message }); });
            completed++;
            if (completed === orden.length) {
              conn.commit(err => {
                if (err) return conn.rollback(() => conn.release());
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

/* ================= ESTADISTICAS ================= */
app.get("/api/estadisticas", (req, res) => {
  db.query("SELECT * FROM estadisticas_proyecto ORDER BY orden ASC", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post("/api/estadisticas", (req, res) => {
  const { numero, titulo, descripcion, activo = 1 } = req.body;

  db.query("SELECT MAX(orden) as maxOrden FROM estadisticas_proyecto", (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    const orden = (result[0]?.maxOrden || 0) + 1;

    db.query(
      "INSERT INTO estadisticas_proyecto (numero, titulo, descripcion, activo, orden) VALUES (?, ?, ?, ?, ?)",
      [numero || '', titulo || '', descripcion || '', activo ? 1 : 0, orden],
      (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: result.insertId, success: true });
      }
    );
  });
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
  if (!Array.isArray(orden)) return res.status(400).json({ error: "orden debe ser array de IDs" });

  db.getConnection((err, conn) => {
    if (err) return res.status(500).json({ error: err.message });

    conn.beginTransaction(err => {
      if (err) { conn.release(); return res.status(500).json({ error: err }); }

      let completed = 0;
      orden.forEach((id, index) => {
        conn.query(
          "UPDATE estadisticas_proyecto SET orden = ? WHERE id = ?",
          [index + 1, id],
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

// Config máximo visible
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

// =============================================
//       ASSISTANT KNOWLEDGE - Contenido Asistente
// =============================================

app.get("/api/assistant-knowledge", (req, res) => {
  db.query("SELECT * FROM assistant_knowledge ORDER BY orden ASC", (err, rows) => {
    if (err) {
      console.error("Error GET assistant-knowledge:", err);
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

app.post("/api/assistant-knowledge", (req, res) => {
  const { titulo, categoria, contenido, palabras_clave, archivos = [], activo = 1 } = req.body;

  db.query("SELECT MAX(orden) as maxOrden FROM assistant_knowledge", (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    const orden = (result[0]?.maxOrden || 0) + 1;

    db.query(
      "INSERT INTO assistant_knowledge (titulo, categoria, contenido, palabras_clave, archivos, activo, orden) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        titulo || '',
        categoria || '',
        contenido || '',
        palabras_clave || '',
        JSON.stringify(archivos),
        activo ? 1 : 0,
        orden
      ],
      (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: result.insertId, success: true });
      }
    );
  });
});

app.put("/api/assistant-knowledge/:id", (req, res) => {
  const id = parseInt(req.params.id);
  const updates = req.body;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "No hay campos para actualizar" });
  }

  let setClause = [];
  let values = [];

  if ('titulo' in updates)       { setClause.push("titulo = ?");       values.push(updates.titulo); }
  if ('categoria' in updates)    { setClause.push("categoria = ?");    values.push(updates.categoria); }
  if ('contenido' in updates)    { setClause.push("contenido = ?");    values.push(updates.contenido); }
  if ('palabras_clave' in updates) { setClause.push("palabras_clave = ?"); values.push(updates.palabras_clave); }
  if ('archivos' in updates)     { setClause.push("archivos = ?");     values.push(JSON.stringify(updates.archivos)); }
  if ('activo' in updates)       { setClause.push("activo = ?");       values.push(updates.activo ? 1 : 0); }

  if (setClause.length === 0) return res.status(400).json({ error: "Ningún campo válido" });

  values.push(id);
  const query = `UPDATE assistant_knowledge SET ${setClause.join(", ")} WHERE id = ?`;

  db.query(query, values, (err) => {
    if (err) {
      console.error("Error PUT assistant-knowledge:", err);
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true });
  });
});

app.delete("/api/assistant-knowledge/:id", (req, res) => {
  const id = parseInt(req.params.id);
  db.query("DELETE FROM assistant_knowledge WHERE id = ?", [id], (err) => {
    if (err) {
      console.error("Error DELETE assistant-knowledge:", err);
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true });
  });
});

app.post("/api/assistant-knowledge-reordenar", (req, res) => {
  const { orden } = req.body;
  if (!Array.isArray(orden)) return res.status(400).json({ error: "orden debe ser array de IDs" });

  db.getConnection((err, conn) => {
    if (err) return res.status(500).json({ error: err.message });

    conn.beginTransaction(err => {
      if (err) { conn.release(); return res.status(500).json({ error: err }); }

      let completed = 0;
      orden.forEach((id, index) => {
        conn.query(
          "UPDATE assistant_knowledge SET orden = ? WHERE id = ?",
          [index + 1, id],
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

// =============================================
//       BASE DE CONOCIMIENTO (Archivos para Asistente)
// =============================================

app.get("/api/base-conocimiento", (req, res) => {
  db.query("SELECT * FROM base_conocimiento ORDER BY orden ASC", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post("/api/base-conocimiento", (req, res) => {
  const { titulo, categoria, descripcion, archivos = [], activo = 1 } = req.body;

  db.query("SELECT MAX(orden) as maxOrden FROM base_conocimiento", (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    const orden = (result[0]?.maxOrden || 0) + 1;

    db.query(
      "INSERT INTO base_conocimiento (titulo, categoria, descripcion, archivos, activo, orden) VALUES (?, ?, ?, ?, ?, ?)",
      [
        titulo || '',
        categoria || '',
        descripcion || '',
        JSON.stringify(archivos),
        activo ? 1 : 0,
        orden
      ],
      (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: result.insertId, success: true });
      }
    );
  });
});

app.put("/api/base-conocimiento/:id", (req, res) => {
  const id = parseInt(req.params.id);
  const updates = req.body;

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No hay campos" });

  let setClause = [];
  let values = [];

  if ('titulo' in updates) { setClause.push("titulo = ?"); values.push(updates.titulo); }
  if ('categoria' in updates) { setClause.push("categoria = ?"); values.push(updates.categoria); }
  if ('descripcion' in updates) { setClause.push("descripcion = ?"); values.push(updates.descripcion); }
  if ('archivos' in updates) { setClause.push("archivos = ?"); values.push(JSON.stringify(updates.archivos)); }
  if ('activo' in updates) { setClause.push("activo = ?"); values.push(updates.activo ? 1 : 0); }

  if (setClause.length === 0) return res.status(400).json({ error: "Ningún campo válido" });

  values.push(id);
  const query = `UPDATE base_conocimiento SET ${setClause.join(", ")} WHERE id = ?`;

  db.query(query, values, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.delete("/api/base-conocimiento/:id", (req, res) => {
  const id = parseInt(req.params.id);
  db.query("DELETE FROM base_conocimiento WHERE id = ?", [id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.post("/api/base-conocimiento-reordenar", (req, res) => {
  const { orden } = req.body;
  if (!Array.isArray(orden)) return res.status(400).json({ error: "orden debe ser array de IDs" });

  db.getConnection((err, conn) => {
    if (err) return res.status(500).json({ error: err.message });

    conn.beginTransaction(err => {
      if (err) { conn.release(); return res.status(500).json({ error: err }); }

      let completed = 0;
      orden.forEach((id, index) => {
        conn.query(
          "UPDATE base_conocimiento SET orden = ? WHERE id = ?",
          [index + 1, id],
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

/* ================= UPLOAD ================= */
const storage = multer.memoryStorage();
const upload = multer({ storage });
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No se subió ningún archivo" });
    }

    const originalName = req.file.originalname.split('.')[0]; // nombre sin extensión
    const extension = req.file.originalname.split('.').pop();
    const timestamp = Date.now();
    const publicId = `sergas/${originalName}_${timestamp}`; // nombre legible + único

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { 
          folder: "sergas",
          public_id: publicId,               // ← esto fuerza el nombre
          resource_type: "raw",              // importante para PDFs, Word, Excel, etc.
          overwrite: false                   // evita sobrescribir si por casualidad coincide
        },
        (error, result) => error ? reject(error) : resolve(result)
      );
      stream.end(req.file.buffer);
    });

    res.json({ url: result.secure_url });
  } catch (err) {
    console.error("Error en upload:", err);
    res.status(500).json({ error: "Error al subir archivo" });
  }
});

/* ================= DELETE FILE ================= */
app.post("/api/delete-file", async (req, res) => {
  const parts = req.body.url.split("/");
  const fileName = parts.pop().split(".")[0];
  const publicId = "sergas/" + fileName;
  await cloudinary.uploader.destroy(publicId);
  res.json({ ok: true });
});

// =============================================
// FUNCIÓN REUTILIZABLE: BORRAR ARCHIVOS DE CLOUDINARY
// =============================================
async function deleteCloudinaryFiles(urls) {
  if (!Array.isArray(urls) || urls.length === 0) return;

  const deletePromises = urls.map(async (url) => {
    if (!url || typeof url !== 'string') return;

    try {
      const parts = url.split("/");
      const fileNameWithExt = parts.pop();
      const fileName = fileNameWithExt.split('.')[0];
      const publicId = "sergas/" + fileName;

      await cloudinary.uploader.destroy(publicId, { resource_type: "raw" });
      console.log(`Archivo borrado de Cloudinary: ${publicId}`);
    } catch (err) {
      console.error(`Error al borrar de Cloudinary (${url}):`, err);
      // No lanzamos error para no frenar el DELETE de la DB
    }
  });

  await Promise.all(deletePromises);
}

// =============================================
// DELETE MEJORADO: assistant_knowledge
// =============================================
app.delete("/api/assistant-knowledge/:id", async (req, res) => {
  const id = parseInt(req.params.id);

  try {
    // 1. Obtenemos los archivos antes de borrar la fila
    const [rows] = await db.promise().query(
      "SELECT archivos FROM assistant_knowledge WHERE id = ?",
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Entrada no encontrada" });
    }

    let urls = [];
    try {
      urls = JSON.parse(rows[0].archivos || '[]');
    } catch {
      urls = [];
    }

    // 2. Borramos los archivos de Cloudinary
    await deleteCloudinaryFiles(urls);

    // 3. Borramos la fila de la DB
    await db.promise().query("DELETE FROM assistant_knowledge WHERE id = ?", [id]);

    res.json({ success: true });
  } catch (err) {
    console.error("Error en DELETE assistant-knowledge:", err);
    res.status(500).json({ error: "Error al eliminar" });
  }
});

// =============================================
// DELETE MEJORADO: base_conocimiento
// =============================================
app.delete("/api/base-conocimiento/:id", async (req, res) => {
  const id = parseInt(req.params.id);

  try {
    // 1. Obtenemos los archivos antes de borrar
    const [rows] = await db.promise().query(
      "SELECT archivos FROM base_conocimiento WHERE id = ?",
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Documento no encontrado" });
    }

    let urls = [];
    try {
      urls = JSON.parse(rows[0].archivos || '[]');
    } catch {
      urls = [];
    }

    // 2. Borramos los archivos de Cloudinary
    await deleteCloudinaryFiles(urls);

    // 3. Borramos la fila de la DB
    await db.promise().query("DELETE FROM base_conocimiento WHERE id = ?", [id]);

    res.json({ success: true });
  } catch (err) {
    console.error("Error en DELETE base-conocimiento:", err);
    res.status(500).json({ error: "Error al eliminar" });
  }
});

/* ================= START ================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Backend corriendo en puerto", PORT));