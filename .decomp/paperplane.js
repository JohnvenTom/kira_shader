l(.1))).mul(.2),u=t((0,tl.floor)(a.mul(.5))).toVar();
u.assign((0,tl.mix)((0,tl.float)(0),u.sub(.97).mul(10),u.greaterThan(.97).toFloat()));
let A=i(a.mul((0,tl.vec2)(1.43,.77))),c=i(a.mul((0,tl.vec2)(.61,1.31)).add((0,tl.vec2)(19.2,7.4))),d=(0,tl.smoothstep)(.52,.92,A.mul(.59).add(c.mul(.41))).mul(.25);
return s.add(o).add(l).mul(.2).sub(u.mul(.3)).sub(d)
});
return{
getPaperColor:(0,tl.Fn)(([e,t,r,a,s,o])=>{
let l=r.toVar(),u=(0,tl.mix)(a,l.rgb,l.a),A=(0,tl.vec4)(u,1).toVar(),c=(0,tl.float)(.2),d=(0,tl.float)(.05),h=(0,tl.smoothstep)(0,c,(0,tl.float)(1).sub((0,tl.abs)(e.x.sub(.5)).mul(2)));
h=(0,tl.pow)(h,d);
let g=A.rgb.toVar(),f=(0,tl.vec3)(.12,.1,.08).mul(.8),p=(0,tl.vec3)(.99,.97,.85),m=(0,tl.clamp)(g,0,1).pow((0,tl.vec3)(1)).mul(.8);
A.rgb.assign(f.add(m.mul(p.sub(f))));
let E=e.add((0,tl.vec2)(0,s)),I=n(E,o),y=(0,tl.dot)(A.rgb,(0,tl.vec3)(.3333333,.3333333,.3333333)),C=(0,tl.float)(1).sub(y),B=(0,tl.mix)((0,tl.float)(1),(0,tl.float)(1.15),l.a),v=(0,tl.smoothstep)(.2,.98,y),b=(0,tl.smoothstep)(.15,.6,C),S=v.mul(.3).add(.95),x=b.mul(1.6).add(1),w=(0,tl.float)(1.2),Q=(0,tl.float)(1.6),R=(0,tl.float)(.5),T=(0,tl.clamp)((0,tl.float)(1).add(v.mul(Q.sub(1))).add(b.mul(R.sub(1))),.05,3),D=(0,tl.float)(1).add(I.mul(.22).mul(S).mul(x).mul(B).mul(T).mul(w)),L=E.mul(o),M=i((0,tl.vec2)(L.x.mul(1.27).add(L.y.mul(.81)),L.x.mul(-.73).add(L.y.mul(1.11)))),k=(0,tl.smoothstep)(.66,.98,M).mul((0,tl.smoothstep)(.55,.98,C)).mul(.05).mul(w).mul(B);
return A.rgb.assign(A.rgb.mul(D).add((0,tl.vec3)(k)).mul(h)),(0,tl.clamp)(A,0,1)
}),paperGrain:n,noise:i
}
}function at({
updateHandle:e
}){
let t=nC(),r=(0,q.useRef)({
dimensions:(0,tl.uniform)(new ev.Vector2(t.width,t.height)),enterProgress:(0,tl.uniform)(0),exitProgress:(0,tl.uniform)(0),exitCurlProgress:(0,tl.uniform)(0),contentTexture:(0,tl.uniformTexture)(new ev.Texture),animateUp:(0,tl.uniform)(1),pageProgress:(0,tl.uniform)(0),pageLength:(0,tl.uniform)(1)
});
(0,q.useEffect)(()=>{
r.current.dimensions.value.set(t.width,t.height)
},[t]),(0,q.useImperativeHandle)(e,()=>({
enterProgress:e,exitProgress:t,pageProgress:i,pageLength:n,aboutUsContentTexture:a,animateDirection:s
})=>{
r.current.enterProgress.value=e,r.current.exitProgress.value=nL(t,0,5),r.current.exitCurlProgress.value=nM(t,-.5,1,1,0),a&&(r.current.contentTexture.value=a),r.current.animateUp.value=+("up"===s),r.current.pageProgress.value=i,r.current.pageLength.value=n
});
let i=(0,q.useMemo)(()=>{
let e=new eB.MeshBasicNodeMaterial;
e.toneMapped=!1,e.transparent=!0;
let t=r.current,{
getPaperColor:i
}=ae((0,tl.uniformTexture)(n7())),n=(0,tl.Fn)(([e,r])=>{
let n=e.add((0,tl.vec2)(0,t.pageProgress.negate())).mul(t.dimensions).mul(.02),a=t.pageProgress.mul(t.pageLength).add(t.exitProgress.div(4).mul(t.animateUp)).negate(),s=(0,tl.texture)(t.contentTexture,(0,tl.vec2)(e.x,(0,tl.oneMinus)(e.y))),o=i(e,n,s,r,a,t.dimensions);
return(0,tl.mix)(r,o.rgb,o.a)
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
}),s=(0,tl.Fn)(([e,t,r,i,s])=>{
let o=(0,tl.float)(.4),l=(0,tl.float)(Math.PI),u=s.x.lessThan(0),A=(0,tl.vec2)((0,tl.abs)(s.x),s.y),c=A.div((0,tl.length)(A)),d=(0,tl.length)(A),h=(0,tl.float)(1).add(o.mul(4)),g=d.mul(h).sub(o.mul(2)),f=o.mul(-2),p=(0,tl.clamp)((0,tl.float)(1).sub(e),0,1),m=(0,tl.mix)(g,f,p),E=(0,tl.vec3)(c,m),I=(0,tl.vec2)((0,tl.mix)(t.x,(0,tl.oneMinus)(t.x),u.toFloat()),(0,tl.mix)((0,tl.oneMinus)(t.y),t.y,r)),y=(0,tl.dot)(I,E.xy),C=(0,tl.abs)((0,tl.vec2)(1).sub(I).div(E.xy)),B=y.add((0,tl.min)(C.x,C.y)),v=a(y,B,E),b=v.x.lessThan(0),S=(0,tl.float)(1).sub((0,tl.smoothstep)(0,o.mul(2),y.sub(E.z).negate())).mul((0,tl.smoothstep)(o.negate(),o,B.sub(v.x.add(l.mul(1.5).mul(o)).add(o)))),x=E.xy.mul(v.x.sub(y)).toVar();
x.x.assign((0,tl.mix)(x.x,x.x.negate(),u.toFloat())),x.y.assign(x.y.mul((0,tl.mix)((0,tl.float)(-1),(0,tl.float)(1),r)));
let w=n(t.add(x),i).toVar(),Q=w.mul(v.y).mul((0,tl.oneMinus)(S)),R=w.mul(.25).add(i.mul((0,tl.vec3)(.7,.67,.5))).mul(v.y.negate());
w.assign((0,tl.mix)(R,Q,v.y.greaterThan(0).toFloat()));
let T=(0,tl.vec4)(w,1);
return(0,tl.mix)(T,(0,tl.vec4)(0,0,0,0),b.toFloat())
});
return e.positionNode=tl.positionLocal,e.colorNode=(0,tl.Fn)(()=>{
(0,tl.If)(t.exitProgress.greaterThan(1),()=>{
(0,tl.Discard)()
});
let e=(0,tl.clamp)((0,tl.step)((0,tl.uv)().y,t.exitProgress).mul((0,tl.step)(.5,t.animateUp)).mul((0,tl.oneMinus)((0,tl.step)(1,t.exitProgress))),0,1),r=(0,tl.mix)(t.exitCurlProgress,t.enterProgress,t.animateUp),i=(0,tl.vec2)(.5,1),n=s(r,(0,tl.uv)(),t.animateUp,(0,tl.vec3)(1),i),a=n.a.mul((0,tl.oneMinus)(e));
return(0,tl.vec4)(n.rgb,(0,tl.clamp)(a,0,1))
})(),e.alphaTestNode=(0,tl.float)(.001),e
},[]);
return(0,W.jsxs)("mesh",{
scale:[t.viewportWidth,t.viewportHeight,1],children:[(0,W.jsx)("planeGeometry",{
args:[1,1,1,1]
}),(0,W.jsx)("primitive",{
object:i,attach:"material"
})]
})
}var ar=Symbol.for("preact-signals");
function ai(){
if(ao>1)ao--;
else{
for(var e,t=!1;
void 0!==as;
){
var r=as;
for(as=void 0,al++;
void 0!==r;
){
var i=r.o;
if(r.o=void 0,r.f&=-3,!(8&r.f)&&ah(r))try{
r.c()
}catch(r){
t||(e=r,t=!0)
}r=i
}
}if(al=0,ao--,t)throw e
}
}function an(e){
if(ao>0)return e();
ao++;
try{
return e()
}finally{
ai()
}
}var aa=void 0,as=void 0,ao=0,al=0,au=0;
function aA(e){
if(void 0!==aa){
var t=e.n;
if(void 0===t||t.t!==aa)return t={
i:0,S:e,p:aa.s,n:void 0,t:aa,e:void 0,x:void 0,r:t
},void 0!==aa.s&&(aa.s.n=t),aa.s=t,e.n=t,32&aa.f&&e.S(t),t;
if(-1===t.i)return t.i=0,void 0!==t.n&&(t.n.p=t.p,void 0!==t.p&&(t.p.n=t.n),t.p=aa.s,t.n=void 0,aa.s.n=t,aa.s=t),t
}
}function ac(e){
this.v=e,this.i=0,this.n=void 0,this.t=void 0
}function ad(e){
return new ac(e)
}function ah(e){
for(var t=e.s;
void 0!==t;
t=t.n)if(t.S.i!==t.i||!t.S.h()||t.S.i!==t.i)return!0;
return!1
}function ag(e){
for(var t=e.s;
void 0!==t;
t=t.n){
var r=t.S.n;
if(void 0!==r&&(t.r=r),t.S.n=t,t.i=-1,void 0===t.n){
e.s=t;
break
}
}
}function af(e){
for(var t=e.s,r=void 0;
void 0!==t;
){
var i=t.p;
-1===t.i?(t.S.U(t),void 0!==i&&(i.n=t.n),void 0!==t.n&&(t.n.p=i)):r=t,t.S.n=t.r,void 0!==t.r&&(t.r=void 0),t=i
}e.s=r
}function ap(e){
ac.call(this,void 0),this.x=e,this.s=void 0,this.g=au-1,this.f=4
}function am(e){
return new ap(e)
}function aE(e){
var t=e.u;
if(e.u=void 0,"function"==typeof t){
ao++;
var r=aa;
aa=void 0;
try{
t()
}catch(t){
throw e.f&=-2,e.f|=8,aI(e),t
}finally{
aa=r,ai()
}
}
}function aI(e){
for(var t=e.s;
void 0!==t;
t=t.n)t.S.U(t);
e.x=void 0,e.s=void 0,aE(e)
}function ay(e){
if(aa!==this)throw Error("Out-of-order effect");
af(this),aa=e,this.f&=-2,8&this.f&&aI(this),ai()
}function aC(e){
this.x=e,this.u=void 0,this.s=void 0,this.o=void 0,this.f=32
}function aB(e){
var t=new aC(e);
try{
t.c()
}catch(e){
throw t.d(),e
}return t.d.bind(t)
}ac.prototype.brand=ar,ac.prototype.h=function(){
return!0
},ac.prototype.S=function(e){
this.t!==e&&void 0===e.e&&(e.x=this.t,void 0!==this.t&&(this.t.e=e),this.t=e)
},ac.prototype.U=function(e){
if(void 0!==this.t){
var t=e.e,r=e.x;
void 0!==t&&(t.x=r,e.e=void 0),void 0!==r&&(r.e=t,e.x=void 0),e===this.t&&(this.t=r)
}
},ac.prototype.subscribe=function(e){
var t=this;
return aB(function(){
var r=t.value,i=aa;
aa=void 0;
try{
e(r)
}finally{
aa=i
}
})
},ac.prototype.valueOf=function(){
return this.value
},ac.prototype.toString=function(){
return this.value+""
},ac.prototype.toJSON=function(){
return this.value
},ac.prototype.peek=function(){
var e=aa;
aa=void 0;
try{
return this.value
}finally{
aa=e
}
},Object.defineProperty(ac.prototype,"value",{
get:function(){
var e=aA(this);
return void 0!==e&&(e.i=this.i),this.v
},set:function(e){
if(e!==this.v){
if(al>100)throw Error("Cycle detected");
this.v=e,this.i++,au++,ao++;
try{
for(var t=this.t;
void 0!==