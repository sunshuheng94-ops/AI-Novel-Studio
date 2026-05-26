import fs from 'node:fs/promises';
import path from 'node:path';

const baseUrl = 'http://127.0.0.1:8188';
const outputPath = path.join(process.cwd(), 'public', 'assistant', 'default.png');

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(typeof data?.message === 'string' ? data.message : text);
  return data;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildWorkflow({ checkpoint, prompt, seed }) {
  return {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    2: { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: prompt } },
    3: { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: 'multiple characters, different outfits, busy background, scenery, portrait crop, close-up, face only, upper body only, cut off feet, cut off legs, low quality, blurry, bad anatomy, bad hands, extra fingers, child, loli, underage, nsfw, cleavage, nude, watermark, logo, text' } },
    4: { class_type: 'EmptyLatentImage', inputs: { width: 768, height: 1344, batch_size: 1 } },
    5: {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
        seed,
        steps: 36,
        cfg: 8,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
      },
    },
    6: { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    7: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'ai_assistant_unified' } },
  };
}

async function waitForImage(promptId) {
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    const history = await fetchJson(`${baseUrl}/history/${promptId}`);
    const outputs = history?.[promptId]?.outputs || {};
    const image = Object.values(outputs).flatMap((output) => output.images || [])[0];
    if (image) return image;
    await sleep(1200);
  }
  throw new Error('ComfyUI generation timed out');
}

async function main() {
  const objectInfo = await fetchJson(`${baseUrl}/object_info/CheckpointLoaderSimple`);
  const checkpoint = objectInfo?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0]?.[0];
  if (!checkpoint) throw new Error('No ComfyUI checkpoint found');

  const prompt = [
    'masterpiece, best quality, anime style adult AI editor assistant character, single character, full body character design sheet style',
    'entire body visible from head to shoes, centered standing pose, clean silhouette, no crop',
    'silver hair, red eyes, petite adult woman, mischievous confident expression, detailed eyes',
    'non revealing futuristic dark purple jacket, coordinated outfit, thigh-high boots, neon pink accents, electric blue rim light',
    'plain white background, no scenery, no props, polished visual novel sprite, consistent character design, safe for work',
  ].join(', ');

  const queued = await fetchJson(`${baseUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: buildWorkflow({ checkpoint, prompt, seed: Math.floor(Math.random() * 1000000000000) }), client_id: crypto.randomUUID() }),
  });

  const image = await waitForImage(queued.prompt_id);
  const params = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '', type: image.type || 'output' });
  const imageResponse = await fetch(`${baseUrl}/view?${params.toString()}`);
  if (!imageResponse.ok) throw new Error('Failed to fetch generated image');

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, Buffer.from(await imageResponse.arrayBuffer()));
  await fs.copyFile(outputPath, path.join(process.cwd(), 'public', 'assistant-default.png'));
  console.log(`Saved ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
