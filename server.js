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
  const id = req.params.id;

  const data = {
    ...req.body
  };

  // Serializar JSON solo si vienen
  if (req.body.tags !== undefined)
    data.tags = JSON.stringify(req.body.tags);

  if (req.body.galeria !== undefined)
    data.galeria = JSON.stringify(req.body.galeria);

  if (req.body.documentos !== undefined)
    data.documentos = JSON.stringify(req.body.documentos);

  // Quitar campos undefined para no pisar DB
  Object.keys(data).forEach(k => {
    if (data[k] === undefined) delete data[k];
  });

  db.query(
    "UPDATE proyectos SET ? WHERE id=?",
    [data, id],
    err => {
      if (err) {
        console.error(err);
        return res.status(500).send("Error update");
      }
      res.send("OK");
    }
  );
});


app.delete("/api/proyectos/:id", (req, res) => {
  db.query("DELETE FROM proyectos WHERE id=?", [req.params.id], err => {
    if (err) return res.status(500).send("Error delete");
    res.send("OK");
  });
});

/* ========================= PROYECTOS PUBLICOS ========================= */

app.get("/api/proyectos-publicos", (req, res) => {
  db.query(
    "SELECT * FROM proyectos WHERE visible = 1 AND LOWER(visibilidad) LIKE '%proyectos%' ORDER BY orden",
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

app.get("/api/proyectos-home", (req, res) => {
  db.query(
    "SELECT * FROM proyectos WHERE visible = 1 AND LOWER(visibilidad) LIKE '%home%' ORDER BY orden",
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
    "SELECT * FROM proyectos WHERE visible = 1 AND LOWER(visibilidad) LIKE '%proyectos%' ORDER BY orden",
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

    // extraer public_id desde la URL
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

/* ================= TIPOS DE OBRA ================= */

app.get("/api/tipos-obra", (req, res) => {
  db.query("SELECT * FROM tipos_obra ORDER BY orden", (err, rows) => {
    if (err) return res.json([]);
    res.json(rows);
  });
});

app.post("/api/tipos-obra", (req, res) => {
  db.query("INSERT INTO tipos_obra SET ?", req.body, err => {
    if (err) return res.status(500).send("Error insert");
    res.send("OK");
  });
});

app.put("/api/tipos-obra/:id", (req, res) => {
  db.query("UPDATE tipos_obra SET ? WHERE id=?", [req.body, req.params.id], err => {
    if (err) return res.status(500).send("Error update");
    res.send("OK");
  });
});

app.delete("/api/tipos-obra/:id", (req, res) => {
  db.query("DELETE FROM tipos_obra WHERE id=?", [req.params.id], err => {
    if (err) return res.status(500).send("Error delete");
    res.send("OK");
  });
});

/* ================= ESTADISTICAS ================= */

app.get("/api/estadisticas", (req, res) => {
  db.query("SELECT * FROM estadisticas", (err, rows) => {
    if (err) return res.json([]);
    res.json(rows);
  });
});

app.put("/api/estadisticas/:id", (req, res) => {
  db.query("UPDATE estadisticas SET ? WHERE id=?", [req.body, req.params.id], err => {
    if (err) return res.status(500).send("Error update");
    res.send("OK");
  });
});

/* ================= CONTENIDO ASISTENTE ================= */

app.get("/api/contenido", (req, res) => {
  db.query("SELECT * FROM contenido LIMIT 1", (err, rows) => {
    if (err) return res.json({});
    res.json(rows[0] || {});
  });
});

app.put("/api/contenido", (req, res) => {
  db.query("UPDATE contenido SET ?", req.body, err => {
    if (err) return res.status(500).send("Error update");
    res.send("OK");
  });
});

/* ================= KNOWLEDGE ================= */

app.get("/api/knowledge", (req, res) => {
  db.query("SELECT * FROM knowledge ORDER BY id DESC", (err, rows) => {
    if (err) return res.json([]);
    res.json(rows);
  });
});

app.post("/api/knowledge", (req, res) => {
  db.query("INSERT INTO knowledge SET ?", req.body, err => {
    if (err) return res.status(500).send("Error insert");
    res.send("OK");
  });
});

app.put("/api/knowledge/:id", (req, res) => {
  db.query("UPDATE knowledge SET ? WHERE id=?", [req.body, req.params.id], err => {
    if (err) return res.status(500).send("Error update");
    res.send("OK");
  });
});

app.delete("/api/knowledge/:id", (req, res) => {
  db.query("DELETE FROM knowledge WHERE id=?", [req.params.id], err => {
    if (err) return res.status(500).send("Error delete");
    res.send("OK");
  });
});

/* ================= USERS ================= */

app.put("/api/users/:id", (req, res) => {
  db.query("UPDATE users SET ? WHERE id=?", [req.body, req.params.id], err => {
    if (err) return res.status(500).send("Error update");
    res.send("OK");
  });
});

/* ========================= ASISTENTE ========================= */

app.post("/api/ask", async (req, res) => {
  try {
    const { pregunta } = req.body;

    if (!pregunta) {
      return res.status(400).json({ error: "No hay pregunta" });
    }

    // Traer conocimiento guardado
    db.query("SELECT contenido FROM knowledge", async (err, rows) => {
      const contexto = rows.map(r => r.contenido).join("\n");

      const response = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content:
              "Sos el asistente de la empresa SERGAS. Respondé en español usando solo esta información:\n" +
              contexto,
          },
          {
            role: "user",
            content: pregunta,
          },
        ],
      });

      res.json({
        respuesta: response.choices[0].message.content,
      });
    });

  } catch (err) {
    console.error("OPENAI ERROR:", err);
    res.status(500).json({ error: "Error asistente" });
  }
});

/* ========================= START ========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => console.log("Backend corriendo en puerto", PORT));