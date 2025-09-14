
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Servir archivos estáticos desde public
app.use(express.static('public'));

// Ruta principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Para desarrollo local, mantener el servidor Express original
app.use('/admin/webhooks', require('./src/server.js'));
app.use('/api/v1/webhook', require('./src/server.js'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor de desarrollo corriendo en puerto ${PORT}`);
});
