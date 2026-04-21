import express from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';

const app = express();
const PORT = 3001;

app.use(cors({
  origin: ['http://localhost:1420', 'http://127.0.0.1:1420'],
  credentials: true,
}));

const OPENAI_API_URL = process.env.OPENAI_API_URL || 'https://api.openai.com';

app.use('/v1', createProxyMiddleware({
  target: OPENAI_API_URL,
  changeOrigin: true,
  pathRewrite: {
    '^/api': '/v1',
  },
  onProxyReq: (proxyReq, req, res) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey) {
      proxyReq.setHeader('Authorization', `Bearer ${apiKey}`);
      proxyReq.removeHeader('x-api-key');
    }
  },
  onError: (err, req, res) => {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Proxy error' });
  },
}));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`AI Proxy server running at http://localhost:${PORT}`);
  console.log(`Forwarding requests to ${OPENAI_API_URL}`);
});
