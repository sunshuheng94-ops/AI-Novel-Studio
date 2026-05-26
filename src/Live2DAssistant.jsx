import { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism4';

const modelPath = '/live2d/assistant/huohuo/huohuo.model3.json';
const motionByState = {
  default: 'Idle',
  processing: 'Thinking',
  haoqi: 'Haoqi',
  qizi: 'Qizi',
  zhentou: 'Zhentou',
  linghun: 'Linghun',
  yaotou: 'Yaotou',
  keshui: 'Keshui',
  scene1: 'Scene1',
};

export default function Live2DAssistant({ state = 'default' }) {
  const hostRef = useRef(null);
  const modelRef = useRef(null);
  const appRef = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;

    async function mount() {
      const host = hostRef.current;
      if (!host) return;

      const app = new PIXI.Application({
        resizeTo: host,
        transparent: true,
        autoDensity: true,
        antialias: true,
      });
      appRef.current = app;
      host.appendChild(app.view);

      try {
        const model = await Live2DModel.from(modelPath, { autoInteract: true });
        if (disposed) {
          model.destroy();
          return;
        }
        modelRef.current = model;
        app.stage.addChild(model);
        const naturalWidth = Math.max(1, model.width);
        const naturalHeight = Math.max(1, model.height);

        const layout = () => {
          const width = host.clientWidth || 320;
          const height = host.clientHeight || 420;
          app.renderer.resize(width, height);
          const scale = Math.min(width / naturalWidth, height / naturalHeight) * 0.94;
          model.scale.set(scale);
          model.anchor.set(0.5, 1);
          model.x = width / 2;
          model.y = height - 4;
        };

        layout();
        const resizeObserver = new ResizeObserver(() => requestAnimationFrame(layout));
        resizeObserver.observe(host);
        window.addEventListener('resize', layout);
        model.once('destroyed', () => {
          resizeObserver.disconnect();
          window.removeEventListener('resize', layout);
        });
      } catch (error) {
        console.error(error);
        setFailed(true);
      }
    }

    mount();

    return () => {
      disposed = true;
      modelRef.current?.destroy();
      appRef.current?.destroy(true, { children: true, texture: false, baseTexture: false });
      modelRef.current = null;
      appRef.current = null;
    };
  }, []);

  useEffect(() => {
    const model = modelRef.current;
    if (!model) return;
    const group = motionByState[state] || 'Idle';
    try {
      model.motion(group, 0, 2);
    } catch {
      try {
        model.motion(undefined, 0, 2);
      } catch {
        // Some third-party model packs omit motion groups.
      }
    }
  }, [state]);

  return (
    <div className="live2d-stage" ref={hostRef}>
      {failed ? <div className="live2d-fallback">Live2D 加载失败</div> : null}
    </div>
  );
}
