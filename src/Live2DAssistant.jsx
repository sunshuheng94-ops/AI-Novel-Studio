export default function Live2DAssistant({ state = 'default' }) {
  return (
    <div className="live2d-stage">
      <div className="live2d-fallback">AI 助手待命：{state}</div>
    </div>
  );
}
