// SPDX-License-Identifier: MPL-2.0
// Independently authored masked-SSE instruction oracle. No engine bytes.
typedef unsigned U;
extern "C" {
__declspec(dllimport) void* __stdcall GetStdHandle(U) asm("_GetStdHandle");
__declspec(dllimport) int __stdcall ReadFile(void*,void*,U,U*,void*) asm("_ReadFile");
__declspec(dllimport) int __stdcall WriteFile(void*,void const*,U,U*,void*) asm("_WriteFile");
__declspec(dllimport) void __stdcall ExitProcess(U) asm("_ExitProcess");
}
static void read(void* data,U size){U n=0;while(size){if(!ReadFile(GetStdHandle((U)-10),data,size,&n,0)||!n)ExitProcess(20);data=(char*)data+n;size-=n;}}
static void write(void const* data,U size){U n=0;while(size){if(!WriteFile(GetStdHandle((U)-11),data,size,&n,0)||!n)ExitProcess(21);data=(char const*)data+n;size-=n;}}
#define FLOAT_OP(name, operation) \
static void name(U a,U b,U control,U*out){ \
 U result,status; \
 asm volatile("ldmxcsr %2\n\tmovss %3,%%xmm0\n\tmovss %4,%%xmm1\n\t" operation "\n\tmovss %%xmm0,%0\n\tstmxcsr %1" : "=m"(result),"=m"(status):"m"(control),"m"(a),"m"(b):"xmm0","xmm1","memory"); \
 out[0]=result;out[1]=status; }
FLOAT_OP(add,"addss %%xmm1,%%xmm0")
FLOAT_OP(subtract,"subss %%xmm1,%%xmm0")
FLOAT_OP(multiply,"mulss %%xmm1,%%xmm0")
FLOAT_OP(divide,"divss %%xmm1,%%xmm0")
FLOAT_OP(root,"sqrtss %%xmm0,%%xmm0")
#define INTEGER_OP(name, operation) \
static void name(U a,U,U control,U*out){ \
 U result,status; \
 asm volatile("ldmxcsr %2\n\tmovss %3,%%xmm0\n\t" operation " %%xmm0,%0\n\tstmxcsr %1" : "=r"(result),"=m"(status):"m"(control),"m"(a):"xmm0","memory"); \
 out[0]=result;out[1]=status; }
INTEGER_OP(convert,"cvtss2si")
INTEGER_OP(truncate,"cvttss2si")
extern "C" void start(){
 U count;read(&count,4);if(count>100000)ExitProcess(22);
 for(U i=0;i<count;i++){U in[4],out[2];read(in,16);if((in[3]&0x1f80)!=0x1f80)ExitProcess(23);
 switch(in[0]){case 0:add(in[1],in[2],in[3],out);break;case 1:subtract(in[1],in[2],in[3],out);break;case 2:multiply(in[1],in[2],in[3],out);break;case 3:divide(in[1],in[2],in[3],out);break;case 4:root(in[1],in[2],in[3],out);break;case 5:convert(in[1],in[2],in[3],out);break;case 6:truncate(in[1],in[2],in[3],out);break;default:ExitProcess(24);}write(out,8);}
 ExitProcess(0);
}
