// SPDX-License-Identifier: MPL-2.0
// Authored sidecars and a Windows host; original parser bytes stay mounted.
#include "native-m2-oracle.cpp"
static U lip[69], levels[8];
void samples(void* object,U countOffset,U valuesOffset,U backupOffset){
 U count=*(U*)((B*)object+countOffset);put(count);
 if(count!=8)ExitProcess(42);
 output(*(void**)((B*)object+valuesOffset),count*4);
 output(*(void**)((B*)object+backupOffset),count*4);
}
extern "C" void lipStart(){
 loadEngine();lip[0]=0x0044504c;lip[1]=1;lip[2]=32;lip[3]=8;*(float*)(lip+4)=-100;
 for(U i=0;i<8;i++){lip[5+i*8]=i;lip[6+i*8]=i%5+1;*(float*)(lip+12+i*8)=-20-(float)i*10;}
 float values[]={0,1,.25f,.5f,.75f,0,1,0};for(U i=0;i<8;i++)*(float*)(levels+i)=values[i];
 output(lip,sizeof lip);output(levels,sizeof levels);
 void*lpb=allocate(64);engine<void*>(0x5a19e0,lpb);
 put(engine<U>(0x5a1a90,lpb,lip,(U)sizeof lip,(U)0));samples(lpb,60,52,56);
 U offsets[]={0,8,12,12,12},invalid[]={0,31,0,8,8},sizes[]={sizeof lip,sizeof lip,sizeof lip,19,255};
 for(U i=0;i<5;i++){U offset=offsets[i]/4,old=lip[offset];lip[offset]=invalid[i];put(engine<U>(0x5a1a90,lpb,lip,sizes[i],(U)0));for(U k=48;k<=60;k+=4)put(*(U*)((B*)lpb+k));lip[offset]=old;}
 void*lv=allocate(60);for(U i=0;i<15;i++)((U*)lv)[i]=0;((U*)lv)[10]=1;
 put(engine<U>(0x5a1df0,lv,levels,(U)sizeof levels+3,(U)0));samples(lv,56,48,52);
 engine<void*>(0x5a1a60,lpb,(U)1);engine<void*>(0x5a1d90,lv,(U)1);ExitProcess(0);
}
