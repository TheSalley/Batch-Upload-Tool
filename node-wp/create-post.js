import axios from 'axios';
import cfg from './config.js';
import { getBaseHeaders } from './wp-auth.js';

export async function createNewsPost(title, content, featuredMediaId = null, status = 'publish') {
  const payload = { title, content, status };
  if (featuredMediaId) payload.featured_media = featuredMediaId;

  const res = await axios.post(
    `${cfg.wp.url}${cfg.wp.apiPrefix}/posts`,
    payload,
    { headers: getBaseHeaders() }
  );
  console.log(`📰 新闻创建成功 ID:${res.data.id} ${title}`);
  return res.data;
}
