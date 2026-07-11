import axios from 'axios';
import cfg from './config.js';
import { getBaseHeaders } from './wp-auth.js';

export async function createWcProduct(name, description, mediaIds = []) {
  const payload = {
    name,
    description,
    status: 'publish',
    type: 'simple',
    images: mediaIds.map(id => ({ id }))
  };

  const res = await axios.post(
    `${cfg.wp.url}${cfg.wp.wcApiPrefix}/products`,
    payload,
    { headers: getBaseHeaders() }
  );
  console.log(`📦 Woo产品创建成功 ID:${res.data.id} ${name}`);
  return res.data;
}
