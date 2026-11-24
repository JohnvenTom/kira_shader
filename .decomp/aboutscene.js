7*(1+.5*e*(2-3*e))*(t*t*t-2*t*t+t)+(-2*t*t*t+3*t*t)*u
}let E=nL(m,0,100);
J.set(f);
let I=nM(n,i.range.start-i.transitionLength,i.range.start+.6,0,1);
m<0&&(j.current=!0),E>.9?G.set(0):I>.1?G.set(1):G.set(0),a?U.current=!0:A<u-.07&&(U.current=!1),I>0&&I<.85?H.set("enter-top"):E>0&&E<1&&U.current?H.set("enter-bottom"):E>0&&E<1&&!U.current&&H.set("exit");
let y=1-(AS-1)/(AS*i.length);
U.current&&(y=u),_.current?.({
progress:m*AS,disablePaperShred:U.current
});
let C=L.current?.({
state:r,progress:f,exitProgress:E,relativePageLength:l,maxContentProgress:y
})??z.current;
F.current?.({
aboutUsContentTexture:C,enterProgress:I,exitProgress:"exit"===H.get()?E*AS:m,pageProgress:f,pageLength:i.length,animateDirection:U.current?"down":"up"
});
let B=V.current,v=M.current&&E>0&&!U.current,b=a||j.current;
return v||a?(B=k.current?.({
state:r,progress:E*AS,offset:b?0:E,initialize:b,pageLength:i.length
})||V.current,j.current=!1,Y.current=!0):Y.current&&(B=k.current?.({
state:r,progress:E*AS,offset:0,initialize:!0,pageLength:i.length
})||V.current,Y.current=!1),M.current?.({
state:r,positionsTexture:B,contentTexture:C,progress:E*AS,opacity:E<0?0:O.get(),pageLength:i.length,exitProgress:E*AS
}),nS({
id:"AboutUsScene",gl:r.gl,fbo:T,scene:Q,camera:w
}),T.texture
},S[14]=w,S[15]=G,S[16]=T,S[17]=J,S[18]=Q,S[19]=O,S[20]=H,S[21]=A):A=S[21],(0,q.useImperativeHandle)(x,A),S[22]!==D?(c=(0,W.jsx)(Au,{
renderHandle:L,warmUp:D
}),S[22]=D,S[23]=c):c=S[23],S[24]!==N?(d=(0,W.jsx)(Av,{
stripCount:N,stripVerticesY:64,renderHandle:k
},N),S[24]=N,S[25]=d):d=S[25],S[26]!==N?(h=(0,W.jsx)(Ah,{
stripCount:N,stripVerticesY:64,updateHandle:M
},N),S[26]=N,S[27]=h):h=S[27],S[28]===Symbol.for("react.memo_cache_sentinel")?(g=(0,W.jsx)(at,{
updateHandle:F
}),f=(0,W.jsx)(Ag,{
updateHandle:_
}),S[28]=g,S[29]=f):(g=S[28],f=S[29]),S[30]===Symbol.for("react.memo_cache_sentinel")?(p=(0,W.jsx)(nm,{
form:"ring",position:[0,5,10],scale:10,color:"white",intensity:10
}),S[30]=p):p=S[30],S[31]===Symbol.for("react.memo_cache_sentinel")?(m=(0,W.jsx)(nm,{
form:"ring",position:[-10,3,-10],scale:5,color:"white",intensity:10
}),S[31]=m):m=S[31],S[32]===Symbol.for("react.memo_cache_sentinel")?(E=(0,W.jsx)(nm,{
form:"box",position:[0,-10,20],scale:7,color:"white",intensity:5
}),S[32]=E):E=S[32],S[33]===Symbol.for("react.memo_cache_sentinel")?(I=(0,W.jsx)(nm,{
form:"ring",position:[0,5,0],scale:4,color:"gold",intensity:10
}),S[33]=I):I=S[33],S[34]===Symbol.for("react.memo_cache_sentinel")?(y=(0,W.jsx)(nm,{
form:"box",position:[5,6,0],scale:5,color:"white",intensity:5
}),S[34]=y):y=S[34],S[35]===Symbol.for("react.memo_cache_sentinel")?(C=(0,W.jsxs)(n5,{
background:!1,children:[p,m,E,I,y,(0,W.jsx)(nm,{
form:"box",position:[-10,-4,0],scale:7,color:"rgb(200, 200, 250)",intensity:5
})]
}),S[35]=C):C=S[35],S[36]!==h?(B=(0,W.jsxs)(W.Fragment,{
children:[h,g,f,C]
}),S[36]=h,S[37]=B):B=S[37],S[38]!==R||S[39]!==Q||S[40]!==B?(v=r7(B,Q,R),S[38]=R,S[39]=Q,S[40]=B,S[41]=v):v=S[41],S[42]!==c||S[43]!==d||S[44]!==v?(b=(0,W.jsxs)(W.Fragment,{
children:[c,d,v]
}),S[42]=c,S[43]=d,S[44]=v,S[45]=b):b=S[45],b
}function Aw(e){
return e.progress
}function AQ(e){
return e.transitionType
}function AR(e){
return e.opacity
}function AT({
updateHandle:e
}){
let t=nC(),r=(0,q.useRef)({
dimensions:(0,tl.uniform)(new ev.Vector2(t.width,t.height)),enterProgress:(0,tl.uniform)(0),pageProgress:(0,tl.uniform)(0),contentTexture:(0,tl.uniformTexture)(new ev.Texture),pageLength:(0,tl.uniform)(1)
});
(0,q.useEffect)(()=>{
r.current.dimensions.value.set(t.width,t.height)
},[t]),(0,q.useImperativeHandle)(e,()=>({
enterProgress:e,pageProgress:t,pageLength:i,accessibilityStatementContentTexture:n
})=>{
r.current.enterProgress.value=nL(e,0,1),r.current.pageProgress.value=nL(t,0,1),r.current.pageLength.value=Math.max(i,1),n&&(r.current.contentTexture.value=n)
});
let i=(0,q.useMemo)(()=>{
let e=new eB.MeshBasicNodeMaterial;
e.toneMapped=!1,e.transparent=!0;
let t=r.current,{
getPaperColor:i
}=ae((0,tl.uniformTexture)(n7())),n=(0,tl.Fn)(([e,r])=>{
let n=t.pageProgress.mul(t.pageLength.sub(1)),a=e.add((0,tl.vec2)(0,n.negate())).mul(t.dimensions).mul(.02),s=n.negate(),o=(0,tl.texture)(t.contentTexture,(0,tl.vec2)(e.x,(0,tl.oneMinus)(e.y))),l=i(e,a,o,r,s,t.dimensions);
return(0,tl.mix)(r,l.rgb,l.a)
}),a=(0,tl.Fn)(([e,t,r])=>{
let i=(0,tl.float)(.15),n=(0,tl.float)(Math.PI),a=(0,tl.vec2)(0).toVar(),s=(0,tl.vec2)(e,1).toVar();
return(0,tl.If)(e.lessThan(r.z.sub(i)),()=>{
a.assign(s)
}).ElseIf(e.greaterThan(r.z.add(i)),()=>{
a.assign((0,tl.vec2)(-1,-1))
}).Else(()=>{
let o=(0,tl.asin)(e.sub(r.z).div(i)),l=o.negate().add(n);
s.x.assign(r.z.add(l.mul(i))),s.y.assign((0,tl.cos)(l)),(0,tl.If)(s.x.lessThan(t),()=>{
a.assign(s)
}).ElseIf(e.lessThan(r.z),()=>{
a.assign((0,tl.vec2)(e,1))
}).Else(()=>{
s.y.assign((0,tl.cos)(o)),s.x.assign(r.z.add(o.mul(i))),a.assign((0,tl.mix)((0,tl.vec2)(-1,-1),s,s.x.lessThan(t).toFloat()))
})
}),a
}),s=(0,tl.Fn)(([e,t,r,i])=>{
let s=(0,tl.float)(.4),o=(0,tl.float)(Math.PI),l=i.x.lessThan(0),u=(0,tl.vec2)((0,tl.abs)(i.x),i.y),A=u.div((0,tl.length)(u)),c=(0,tl.length)(u),d=(0,tl.float)(1).add(s.mul(4)),h=c.mul(d).sub(s.mul(2)),g=s.mul(-2),f=(0,tl.clamp)((0,tl.float)(1).sub(e),0,1),p=(0,tl.mix)(h,g,f),m=(0,tl.vec3)(A,p),E=(0,tl.vec2)((0,tl.mix)(t.x,(0,tl.oneMinus)(t.x),l.toFloat()),t.y),I=(0,tl.dot)(E,m.xy),y=(0,tl.abs)((0,tl.vec2)(1).sub(E).div(m.xy)),C=I.add((0,tl.min)(y.x,y.y)),B=a(I,C,m),v=B.x.lessThan(0),b=(0,tl.float)(1).sub((0,tl.smoothstep)(0,s.mul(2),I.sub(m.z).negate())).mul((0,tl.smoothstep)(s.negate(),s,C.sub(B.x.add(o.mul(1.5).mul(s)).add(s)))),S=m.xy.mul(B.x.sub(I)).toVar();
S.x.assign((0,tl.mix)(S.x,S.x.negate(),l.toFloat()));
let x=n(t.add(S),r).toVar(),w=x.mul(B.y).mul((0,tl.oneMinus)(b)),Q=x.mul(.25).add(r.mul((0,tl.vec3)(.7,.67,.5))).mul(B.y.negate());
x.assign((0,tl.mix)(Q,w,B.y.greaterThan(0).toFloat()));
let R=(0,tl.vec4)(x,1);
return(0,tl.mix)(R,(0,tl.vec4)(0,0,0,0),v.toFloat())
});
return e.positionNode=tl.positionLocal,e.colorNode=(0,tl.Fn)(()=>{
let e=s(t.enterProgress,(0,tl.uv)(),(0,tl.vec3)(1),(0,tl.vec2)(.5,1));
return(0,tl.vec4)(e.rgb,(0,tl.clamp)(e.a,0,1))
})(),e.alphaTestNode=(0,tl.float)(.001),e
},[]);
return(0,W.jsxs)("mesh",{
scale:[t.viewportWidth,t.viewportHeight,1],children:[(0,W.jsx)("planeGeometry",{
args:[1,1,1,1]
}),(0,W.jsx)("primitive",{
object:i,attach:"material"
})]
})
}function AD(){
let e,t,r,i,n=(0,K.c)(6),a=nC();
a.width,a.height,n[0]===Symbol.for("react.memo_cache_sentinel")?(e={
marginBottom:60
},n[0]=e):e=n[0];
let s="/textures/accessibility_statement.webp";
return n[1]!==s?(t=(0,W.jsx)(uk,{
width:"100%",aspectRatio:2.3333333333333335,children:(0,W.jsx)(u_,{
src:s,width:"100%",height:"auto",objectFit:"cover",positionBottom:0,positionType:"absolute",positionLeft:0,positionRight:0
})
}),n[1]=s,n[2]=t):t=n[2],n[3]===Symbol.for("react.memo_cache_sentinel")?(r=(0,W.jsx)(u_,{
src:uV.src,width:200,height:"auto",positionType:"absolute",positionRight:60,positionBottom:20,zIndexOffset:2,lg:{
display:"flex"
},display:"none"
}),n[3]=r):r=n[3],n[4]!==t?(i=(0,W.jsxs)(uk,{
width:"100%",height:"auto",positionType:"relative",marginBottom:30,md:e,paddingX:0,children:[t,r]
}),n[4]=t,n[5]=i):i=n[5],i
}var AL=e.i(76763);
function AM(e){
let t,r,i,n,a,s,o,l,u,A,c,d=(0,K.c)(12);
d[0]===Symbol.for("react.memo_cache_sentinel")?(t={
fontSize:22,lineHeight:"26px",fontWeight:"bold",marginBottom:-4,lg:{
fontSize:24,lineHeight:"32px",marginBottom:-6
},xl:{
fontSize:28,lineHeight:"36px",marginBottom:-8
}
},d[0]=t):t=d[0];
let h=t;
d[1]===Symbol.for("react.memo_cache_sentinel")?(r={
default:{
display:"none"
},1250:{
display:"flex"
}
},d[1]=r):r=d[1];
let g=uJ(r);
return d[2]===Symbol.for("react.memo_cache_sentinel")?(i={
paddingX:16,paddingY:12
},n={
paddingX:40,paddingY:16
},a={
paddingX:40,paddingY:24
},d[2]=i,d[3]=n,d[4]=a):(i=d[2],n=d[3],a=d[4]),d[5]===Symbol.for("react.memo_cache_sentinel")?(s=(0,W.jsx)(uk,{
width:"100%",paddingX:16,paddingTop:8,paddingBottom:8,sm:i,md:n,xl:a,alignItems:"center",justifyContent:"center",maxWidth:1600,marginX:"auto",maxHeight:2e3,children:(0,W.jsx)(uP,{
textAlign:"center",width:"100%",fontSize:42,lineHeight:"42px",sm:{
fontSize:48,lineHeight:"48px",maxWidth:640
},md:{
fontSize:64,lineHeight:"64px"
},lg:{
fontSize:96,lineHeight:"96px",maxWidth:1080
},xl:{
fontSize:110,lineHeight:"110px",maxWidth:1080
},children:AL.accessibilityIntroMd.title
})
}),d[5]=s):s=d[5],d[6]===Symbol.for("react.memo_cache_sentinel")?(o=AL.accessibilityContentBlocksMd.map((e,t)=>"heading"===e.type&&2===e.depth?(0,W.jsx)(uk,{
flexDirection:"column",gap:16,children:(0,W.jsx)(uP,{
...h,children:e.text
})
},t):"paragraph"===e.type?(0,W.jsx)(uP,{
...uZ,children:e.text
},t):"list"===e.type?(0,W.jsx)(uk,{
flexDirection:"column",gap:12,children:e.items.map(Ak)
},t):null),d[6]=o):o=d[6],d[7]===Symbol.for("react.memo_cache_sentinel")?(l=(0,W.jsxs)(uk,{
flexDirection:"column",gap:12,children:[(0,W.jsx)(uP,{
fontSize:24,lineHeight:"24px",fontWeight:"medium",children:"The Management"
}),(0,W.jsx)(uP,{
fontSize:24,lineHeight:"20px",fontWeight:"bold",children:u3.company.name
})]
}),d[7]=l):l=d[7],d[8]===Symbol.for("react.memo_cache_sentinel")?(A=(0,W.jsx)(u_,{
src:uK.src,width:300,height:"auto"
}),u=(0,W.jsx)(uP,{
fontWeight:"medium",children:"A High Tech Business Solutions Company"
}),d[8]=u,d[9]=A):(u=d[8],A=d[9]),d[10]!==g?(c=(0,W.jsxs)(W.Fragment,{
children:[s,(0,W.jsx)(uk,{
width:"100%",display:"flex",maxWidth:1080,marginX:"auto",children:(0,W.jsxs)(uk,{
flexDirection:"column",gap:36,paddingBottom:48,children:[o,(0,W.jsxs)(uk,{
paddingTop:32,flexDirection:"row",alignItems:"space-between",justifyContent:"space-between",width:"100%",children:[l,(0,W.jsxs)(uk,{
flexDirection:"column",gap:16,display:"none",marginTop:24,justifyContent:"flex-end",...g,children:[A,u]
})]
})]
})
})]
}),d[10]=g,d[11]=c):c=d[11],c
}function Ak(e,t){
return(0,W.jsxs)(uP,{
...uZ,children:["- ",e.text]
},t)
}function AF({
renderHandle:e
}){
let{
pixelSize:t
}=uU(),{
scene:r,camera:i,portalOptions:n
}=nZ({
pageType:"about-us",type:"perspective",fov:65,basePosition:[0,0,5]
}),a=(0,q.useRef)(0),s=nC(),o=ng();
n0({
scene:r,camera:i,fbo:o,hookId:"AccessibilityStatementContent",passes:2
}),(0,q.useImperativeHandle)(e,()=>({
state:e,progress:t
})=>{
let n=l.get();
n?.type==="accessibility-statement"&&a.current!==n.pageCount&&l.set({
...n,pageCount:a.current
});
let u=Math.max(a.current-1,0);
return i.position.y=-t*s.viewportHeight*u,nS({
scene:r,camera:i,fbo:o,gl:e.gl,id:"AccessibilityStatementContent"
}),o.texture
});
let l=(0,ee.usePagesStore)(e=>e.subPage),u=uN({
onSizeChange:({
height:e
})=>{
a.current=e/s.height
}
}),A=(0,q.useMemo)(()=>`${
s.width
}x${
s.height
}`,[s.width,s.height]);
return r7((0,W.jsx)(uO,{
children:(0,W.jsx)("group",{
position:[0,-(.5*(4*s.viewportHeight))+.5*s.viewportHeight,0],scale:[1,1,1],children:(0,W.jsx)(uk,{
width:s.width,height:4*s.height,sizeX:s.viewportWidth,sizeY:4*s.viewportHeight,flexDirection:"column",pixelSize:t,fontFamilies:o1,children:(0,W.jsx)(uk,{
flexDirection:"column",flexGrow:0,paddingTop:0,height:"auto",children:(0,W.jsxs)(uk,{
ref:u,flexDirection:"column",children:[(0,W.jsx)(AD,{

}),(0,W.jsx)(uk,{
flexDirection:"column",paddingX:32,sm:{
paddingX:42
},md:{
paddingX:72
},lg:{
paddingX:90
},xl:{
paddingX:90
},children:(0,W.jsx)(AM,{
columnCount:3
})
}),(0,W.jsx)(uG,{
style:{
paddingTop:0,paddingBottom:0,sm:{
paddingTop:0,paddingBottom:24
},md:{
paddingBottom:48
}
}
})]
})
})
},A)
})
}),r,n)
}function A_(e){
let t,r,i,n,a,s,o=(0,K.c)(17),{
renderHandle:l
}=e;
o[0]===Symbol.for("react.memo_cache_sentinel")?(t={
type:"perspective",fov:65,basePosition:[0,0,5]
},o[0]=t):t=o[0];
let{
camera:u,scene:A,portalOptions:c
}=nZ(t),d=ng(),h=(0,q.useRef)(null),g=(0,q.useRef)(null),f=(0,ee.usePagesStore)(AG),p=(0,ee.usePagesStore)(AO),m=(0,ee.usePagesStore)(AU),E=(0,ee.usePagesStore)(AN),I=(0,eh.useScrollStore)(AP);
return o[1]!==u||o[2]!==d||o[3]!==E||o[4]!==m||o[5]!==A||o[6]!==I||o[7]!==f||o[8]!==p?(r=()=>e=>{
let{
state:t
}=e,r=nM(p.get(),0,1,0,.8);
E.get()||(r=nM(m.get(),0,1,0,.8));
let i=I.get(),n=f.get(),a=n?.type==="accessibility-statement"?n.pageCount:1,s=h.current?.({
state:t,progress:i
})??null;
return g.current?.({
enterProgress:r,pageProgress:i,pageLength:a,accessibilityStatementContentTexture:s
}),nS({
scene:A,camera:u,fbo:d,gl:t.gl,id:"AccessibilityStatementScene"
}),d.texture
},o[1]=u,o[2]=d,o[3]=E,o[4]=m,o[5]=A,o[6]=I,o[7]=f,o[8]=p,o[9]=r):r=o[9],(0,q.useImperativeHandle)(l,r),o[10]===Symbol.for("react.memo_cache_sentinel")?(i=(0,W.jsx)(AF,{
renderHandle:h
}),o[10]=i):i=o[10],o[11]===Symbol.for("react.memo_cache_sentinel")?(n=(0,W.jsx)(AT,{
updateHandle:g
}),o[11]=n):n=o[11],o[12]!==c||o[13]!==A?(a=r7(n,A,c),o[12]=c,o[13]=A,o[14]=a):a=o[14],o[15]!==a?(s=(0,W.jsxs)(W.Fragment,{
children:[i,a]
}),o[15]=a,o[16]=s):s=o[16],s
}function AP(e){
return e.accessibilityStatementPage.scrollProgress
}function AN(e){
return e.initialTransitionDone
}function AU(e){
return e.initialTransition
}function AO(e){
return e.subPageTransition
}function AG(e){
return e.subPage
}let AH=(0,tl.Fn)(([e,t,r])=>{
let i=e.sub(.5),n=i.x.mul(i.x).add(i.y.mul(i.y)),a=(0,tl.float)(1).add(n.mul(t.add(r.x.mul((0,tl.pow)(n,.5))))),s=(0,tl.float)(1).add(n.mul(t.add(r.y.mul((0,tl.pow)(n,.5)))));
return(0,tl.vec2)(i.x.mul(a),i.y.mul(s)).add(.5)
}),Aj=(0,tl.Fn)(([e,t,r])=>{
let i=(0,tl.float)(0),n=(0,tl.mix)((0,tl.float)(.3655),(0,tl.float)(0),r),a=(0,tl.vec2)((0,tl.float)(1).sub(t.mul(n)),(0,tl.float)(1).sub(t.mul(n))),s=(0,tl.vec2)(t.mul(n).mul(.5),t.mul(n).mul(.5));
return a.mul(AH(e,i.add(0),t)).add(s)
}),Az=(0,tl.Fn)(([e,t,r])=>{
let i=(0,tl.abs)(e).sub(t).add(r),n=(0,tl.max)(i,(0,tl.vec2)(0));
return(0,tl.length)(n).add((0,tl.min)((0,tl.max)(i.x,i.y),(0,tl.float)(0))).sub(r)
}),AV=(0,tl.Fn)(([e,t,r,i])=>{
let n=(0,tl.mix)((0,tl.float)(0),(0,tl.float)(.04),r),a=(0,tl.mix)((0,tl.float)(0),(0,tl.float)(.005),r),s=(0,tl.float)(1).toVar();
s.assign(s.mul((0,tl.smoothstep)(a.negate(),a,t.x))),s.assign(s.mul((0,tl.smoothstep)(a.negate(),a,t.y))),s.assign(s.mul((0,tl.smoothstep)(a.negate(),a,(0,tl.oneMinus)(t.x)))),s.assign(s.mul((0,tl.smoothstep)(a.negate(),a,(0,tl.oneMinus)(t.y))));
let o=(0,tl.vec2)(i.x.div(i.y),(0,tl.float)(1)),l=Az(t.sub(.5).mul(o),o.mul(.5),n),u=(0,tl.float)(1).sub((0,tl.smoothstep)(a.negate(),a,l)).mul(s);
return(0,tl.vec4)(e.rgb.mul(u),e.a)
}),AW=(0,tl.Fn)(([e,t,r,i,n])=>{
let a=(0,tl.vec4)(0).toVar(),s=Aj(t,r,i),o=s.x.greaterThanEqual(0).and(s.x.lessThanEqual(1)).and(s.y.greaterThanEqual(0)).and(s.y.lessThanEqual(1));
return(0,tl.If)(o,()=>{
a.assign(AV((0,tl.texture)(e,s),s,i,n))
}),a
});
var AK=tl,AJ=eB;
let AY=new AJ.QuadMesh(null),Aq=new ev.Vector2;
class A$ extends AJ.TempNode{
static get type(){
return"MipMapBlurNode"
}inputNode;
radius;
levels;
preFilter;
emulateInputMip1;
_downsamplingRenderTargets;
_upsamplingRenderTargets;
_firstDownsampleMaterial;
_firstTexelSize;
_downsamplingMaterial;
_upsamplingMaterial;
_textureOutput;
_outputRenderTarget;
_lastWidth;
_lastHeight;
_pendingWidth;
_pendingHeight;
_resizeRequestedAt;
constructor(e,t=.85,r=8,i=null,n=!1){
super("vec4"),this.inputNode=e,this.radius="number"==typeof t?(0,tl.uniform)(t):t,this.levels=r,this.preFilter=i,this.emulateInputMip1=n,this._downsamplingRenderTargets=[],this._upsamplingRenderTargets=[],this._firstDownsampleMaterial=null,this._firstTexelSize=(0,tl.uniform)(new ev.Vector2),this._downsamplingMaterial=null,this._upsamplingMaterial=null,this._outputRenderTarget=new ev.RenderTarget(1,1,{
depthBuffer:!1,type:ev.HalfFloatType
}),this._outputRenderTarget.texture.name="MipMapBlur.output",this._outputRenderTarget.texture.generateMipmaps=!1;
for(let e=0;
e<r;
e++){
const t=new ev.RenderTarget(1,1,{
depthBuffer:!1,type:ev.HalfFloatType
});
t.texture.name=`MipMapBlur.down${
e
}`,t.texture.generateMipmaps=!1,this._downsamplingRenderTargets.push(t)
}this._upsamplingRenderTargets.push(this._outputRenderTarget);
for(let e=1;
e<r-1;
e++){
const t=new ev.RenderTarget(1,1,{
depthBuffer:!1,type:ev.HalfFloatType
});
t.texture.name=`MipMapBlur.up${
e
}`,t.texture.generateMipmaps=!1,this._upsamplingRenderTargets.push(t)
}this._textureOutput=(0,tl.passTexture)(this,this._outputRenderTarget.texture),this._lastWidth=0,this._lastHeight=0,this.updateBeforeType=AJ.NodeUpdateType.FRAME
}getTextureNode(){
return this._textureOutput
}setSize(e,t){
let r=e,i=t;
for(let e=0;
e<this.levels;
e++)r=Math.ro