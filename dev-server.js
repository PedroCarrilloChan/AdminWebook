
require('dotenv/config');
const express = require('express');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para parsear JSON
app.use(express.json());
app.use(express.raw({ type: 'application/json' }));

// Servir archivos estáticos desde public
app.use(express.static('public'));

// Ruta principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Proxy simple para las rutas API durante desarrollo
app.all('/admin/webhooks*', (req, res) => {
  res.status(501).json({ 
    error: 'API en desarrollo', 
    message: 'Para desarrollo completo, use: npm run dev:functions' 
  });
});

app.all('/api/v1/webhook/*', (req, res) => {
  res.status(501).json({ 
    error: 'API en desarrollo', 
    message: 'Para desarrollo completo, use: npm run dev:functions' 
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor de desarrollo corriendo en puerto ${PORT}`);
  console.log(`Frontend disponible en: http://localhost:${PORT}`);
  console.log(`Para API completa ejecuta: npm run dev:functions`);
});
