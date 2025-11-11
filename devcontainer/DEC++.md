# C++ Development Environment

C++ development environment is a very complex topic that need a separate document.

- I mainly work on small or single source file cpp projects, you can see some of them in this repository.
- I'd like to avoid GNU and GPL items and that adds a lot of complexity.
- I'd like to keep using alpine and musl and that add a lot of complexity.

First, build LLVM and clang by gcc.

> I've been away from large native projects for many years
> and there were a lot of difficulties in the process, log them here for reference

1. git clone llvm-project takes forever time, download zip and COPY them into image
   dockerfile COPY command ignores relative path outside of build context (current directory),
   so you have to move all files into this folder to make COPY work
   - git clone depth=1 actually takes not that much time, compress them and ADD to image
2. install cmake: `apk add cmake`
3. run a basic cmake command:
   ```
   cmake -S /llvm-src/llvm -B /llvm-build -G Ninja \
       -DLLVM_ENABLE_PROJECTS="clang;lld" -DCMAKE_INSTALL_PREFIX=/llvm-install \
       -DCMAKE_BUILD_TYPE=Debug \
       -DLLVM_PARALLEL_COMPILE_JOBS=16 -DLLVM_PARALLEL_LINK_JOBS=16
   ```
   use debug because that should be faster, use j16 because I have 32 hardware threads on my machine
   - error no ninja: apk add ninja
   - error no c/c++ compiler: apk add build-base
   - warning no python: apk add python3
   - warning no zlib: more on this later
   - unexpected error that search result indicates clear and retry, restart container
   - this cmake command run success
4. ninja -t targets result in target display overflow terminal cache
   - run ninja install, nearly all CPU thread start to work!
   - gcc or ld terminated with signal kill, which later known is out of memory
   - run with j24, ALL CPU thread start to work!
   - add memory by adding memory = 24GB into $env:USERPROFILE/.wslconfig, out of memory in later stage
   - stop hyperv machines and restart computer and retry, out of memory in later stage
   - understand j count related with max memory requirement, restrict to j4
   - error missing asm/prctl.h file: apk add linux-headers
   - this build command run success!
   - restrict LLVM_TARGETS_TO_BUILD to only x86 (this represents amd64 in this target list) and reduce target count from 5666 to 4385
5. try a c++ helloworld program that use `#include <print>` (not import std, not iostream) error no c++ standard library
6. build libc++
   - try build libc++ standalone, gcc seems not able to build libc++
   - add libcxx to main cmake command: add -DLLVM_ENABLE_RUNTIMES="libcxx;libcxxabi;libunwind"
   - error at building libcxx and error happen before installing llvm and clang, which is inconvenient
   - try ninja install-clang, install-llvm-libraries, install-llvm-headers can install clang but cannot install lld and llvm-* tools
   - formalize basic build result into an image, start new container from this image
7. explore randomly
   - gcc -dumpmachine shows x86_64-alpine-linux-musl, while build result clang shows x86_64-unknown-linux-gnu, more on this later
   - configure libc++ to standalone build indicates gcc cannot build libc++ again
   - ai tells me compiler-rt is necessary, try build compiler-rt alone but not quite work
   - try manually specify build result clang to build libc++ but cmake fails to validate build result clang is a workable c compiler
   - try https://github.com/llvm/llvm-project/issues/150122, not work
   - try to compile a c language helloworld program to show build result clang can work
   - /llvm-install/bin/clang -c main.c -o main.c.o works ok
   - /llvm-install/bin/clang main.c.o -o main error lgcc not found, crtbegin.S not found, while I can find them in /usr/lib/gcc
   - by adding -B/usr/lib/gcc/x86_64-alpine-linux-musl/14.2.0 and -L/usr/lib/gcc/x86_64-alpine-linux-musl/14.2.0 results in new error,
     which is previously cmake warned zlib not found error, this is lld not built with zlib error, not missing zlib library error,
     also find that apk add zlib still does not add the zlib library in the error message, find that need to apk add zlib-dev
   - wait for complete rebuild of llvm and clang, then build result clang and lld successfully generates an executable file
   - run the file but shell raises file not found error? file command can display file type is elf, ai says its because loader is incorrect
     ldd shows it's using normal linux's dynamic loader /lib64/ld-linux-x86-64.so.2 which is not available on alpine linux
   - explicltly using musl's dynamic loader /lib/ld-musl-x86_64.so.1 to run the program successfully prints helloworld
   - try reconfigure cmake to include compiler-rt and libc++, shows same error
   - try exclude unwind, error shows need to explicitly exclude unwind by cmake parameter, try again shows same error
   - try exclude libcxxabi, cmake directly error on missing libcxxabi related targets
   - try exclude libcxx, only remain compiler-rt, works, not sure how to use it
8. many issues indicate that target triple is related issue
   - ai tells me to use LLVM_DEFAULT_TRAGET_TRIPLE, set this to gcc -dumpmachine result value
   - rebuild llvm, c program naturally works with clang -c + clang main.c.o without other parameters
   - compile-rt error message shows execinfo.h not found, which is a glibc specific header
     cannot disable this include or this source file specifically, disable this compiler-rt component by COMPILER_RT_BUILD_GWP_ASAN=OFF
   - libc++ error message shows function not found, goes to source code find this is wrapped inside a #if _LIBCPP_HAS_MUSL_LIBC,
     search for cmake files find related cmake variable LIBCXX_HAS_MUSL_LIBC and libc++ build successfully
   - try c++ helloworld program again, clang -c command error missing header file,
     add -I/llvm-install/include/c++/targettriple and produce a main.cpp.o object file
   - link the main.cpp.o results in classic many symbol not found error, add -fuse-ld=lld.ld make these error message a lot more clear
   - add -L/llvm-install/lib/targettriple and -lc++ successfully generates an executable file
   - running the program shows cannot find libc++ library error, ldd this file shows cannot find libc++ library error,
     set LD_RUNTIME_LIBRARY to same library path successfully prints helloworld
   - add Wl,-rpath to library path successfully generates an executable file that directly runs and prints helloworld!

Then, build LLVM and clang by LLVM and clang.
