// Development-only fixture. Not imported by index.html and not emitted by Vite build.
// Real Camera lifecycle + canvas stream; landmarks are synthetic except ?models=real.
import { FaceLandmarker, HandLandmarker } from '@mediapipe/tasks-vision';
let scene = 'center';
let stopped = 0;
let closed = 0;
const toolbar = document.createElement('div');
toolbar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#fff2d9;padding:8px 16px;font:12px sans-serif;display:flex;gap:12px;align-items:center;border-top:2px solid #d7764d';
toolbar.innerHTML = '<strong>ТЕСТ · СИНТЕТИЧЕСКИЕ ДАННЫЕ</strong><label>Кадр <select id="fixture-scene"><option value="center">Оба глаза открыты</option><option value="left">Левый прикрыт</option><option value="right">Правый прикрыт</option><option value="away">Взгляд в сторону</option><option value="gone">Нет лица</option><option value="frozen">Кадр замер</option><option value="denied">Доступ запрещён</option><option value="slow">Медленный запуск</option><option value="ended">Камера отключилась</option></select></label><span id="fixture-counts"></span>';
document.body.append(toolbar);
const select = toolbar.querySelector<HTMLSelectElement>('select')!;
select.addEventListener('change', () => { scene = select.value; });
function face() {
  if (scene === 'gone') return [];
  const f = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  for (const [a,b,top,bottom,iris,x] of [[33,133,159,145,468,0.35],[362,263,386,374,473,0.65]]) {
    f[a]={x:x-.05,y:.4,z:0};f[b]={x:x+.05,y:.4,z:0};f[top]={x,y:.39,z:0};f[bottom]={x,y:.41,z:0};f[iris]={x:scene==='away'?x+.05:x,y:.4,z:0};
  }
  f[10]={x:.5,y:.2,z:0};f[152]={x:.5,y:.8,z:0};f[1]={x:.5,y:.5,z:0}; return [f];
}
function hands() {
  if (!['left','right','away'].includes(scene)) return [];
  const x = scene === 'right' ? .35 : .65;
  return [Array.from({length:21},(_,i)=>({x:x+(i%2?.07:-.07),y:i%4<2?.3:.5,z:0}))];
}
if (new URLSearchParams(location.search).get('models') !== 'real') {
  FaceLandmarker.createFromOptions = async () => ({detectForVideo:()=>({faceLandmarks:face()}),close:()=>{closed++;}} as unknown as FaceLandmarker);
  HandLandmarker.createFromOptions = async () => ({detectForVideo:()=>({landmarks:hands()}),close:()=>{closed++;}} as unknown as HandLandmarker);
}
Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{
  if (scene === 'denied') throw new DOMException('Fixture denial','NotAllowedError');
  if (scene === 'slow') await new Promise(resolve => setTimeout(resolve, 2000));
  const canvas = document.createElement('canvas');canvas.width=640;canvas.height=480;
  const ctx=canvas.getContext('2d')!;
  const stream=canvas.captureStream(15);
  const track=stream.getVideoTracks()[0], originalStop=track.stop.bind(track);
  let ended=false;
  track.stop=()=>{if(!ended){ended=true;stopped++;clearInterval(timer);}originalStop();};
  const timer=setInterval(()=>{
    if(scene==='frozen') return;
    if(scene==='ended'){track.dispatchEvent(new Event('ended'));return;}
    ctx.fillStyle='#e2e7d9';ctx.fillRect(0,0,640,480);ctx.fillStyle='#334c43';ctx.font='28px sans-serif';ctx.fillText('TEST FRAME',220,220);ctx.fillText(String(Date.now()).slice(-5),240,270);
  },70);
  return stream;
}});
setInterval(()=>{document.querySelector('#fixture-counts')!.textContent=`Дорожки остановлены: ${stopped} · Модели закрыты: ${closed}`;},100);
await import('../src/main.ts');
