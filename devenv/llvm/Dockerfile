
# docker build --target llvm-stage1 --tag my/llvm:stage1 .
FROM alpine:3.23.3 AS llvm-stage1

# in the same directory that calls git clone (outside of repository)
# tar cJf llvm-project.tar.xz -C ./llvm-project .
# for reference
#   github webpage downloaded zip file is about 300m
#   uncompress size is 2GB WITHOUT the .git folder
#   git cloned repository archived tar.xz file is about 426m
#   uncompress size is estimated 2.6GB with .git folder
ADD --chown=0 llvm-project.tar.xz /llvm-src

COPY --from=my/shell:1 /etc/apk/repositories /etc/apk/repositories
# build-base: include gcc, g++, ar, ld, make
# python3: this is python3.12 for now
# linux-headers: some source file is using gnu linux specific headers,
#    docs does not mention this, I think this naturally exists in normal distro
# git: this is used in --version display, good to have
# zlib: missing zlib will make you completely compile llvm again if you need zlib later
RUN apk add --no-cache build-base cmake ninja python3 linux-headers git zlib-dev

# https://cmake.org/cmake/help/latest/manual/cmake-presets.7.html
# CMAKE_INSTALL_PREFIX: install in other location to make later COPY simpler
# LLVM_ENABLE_PROJECTS: include clang and linker
# LLVM_ENABLE_RUNTIMES: include compiler-rt and libc++
# LLVM_INCLUDE_TESTS, LLVM_INCLUDE_EXAMPLES: these seems only reduce a few targets
# LLVM_DEFAULT_TARGET_TRIPLE: seems need explicitly specify musl
# CLANG_DEFAULT_CXX_STDLIB, CLANG_DEFAULT_RT_LIB: clang does not have this kind of config?
# COMPILE_RT_BUILD_GWP_ASAN: this include a glibc dependency and cannot opt out that alone, so disable this component for now
# LIBCXX_HAS_MUSL_LIBC: or else this depend on glibc
# LLVM_PARALLEL_COMPILE_JOBS, LLVM_PARALLEL_LINK_JOBS: j8, note that preset json does not support int, this need to be string
# # ? separate ninja install into another RUN cause constant cache miss?
RUN <<RUNEOF
set -ex
cat <<'CATEOF' > /llvm-src/llvm/CMakePresets.json
{
  "version": 10,
  "configurePresets": [
    {
      "name": "release",
      "generator": "Ninja",
      "binaryDir": "/llvm-build",
      "cacheVariables": {
        "CMAKE_BUILD_TYPE": "Release",
        "CMAKE_INSTALL_PREFIX": "/llvm-install",
        "LLVM_ENABLE_PROJECTS": "clang;lld",
        "LLVM_ENABLE_RUNTIMES": "compiler-rt;libcxx;libcxxabi;libunwind",
        "LLVM_TARGETS_TO_BUILD": "X86",
        "LLVM_DEFAULT_TARGET_TRIPLE": "x86_64-alpine-linux-musl",
        "LLVM_INCLUDE_TESTS": false,
        "LLVM_INCLUDE_EXAMPLES": false,
        "CLANG_DEFAULT_CXX_STDLIB": "libc++",
        "CLANG_DEFAULT_RTLIB": "compiler-rt",
        "COMPILER_RT_BUILD_GWP_ASAN": false,
        "LIBCXX_HAS_MUSL_LIBC": true,
        "LIBCXX_USE_COMPILER_RT": true,
        "LIBCXXABI_USE_COMPILER_RT": true,
        "LLVM_PARALLEL_COMPILE_JOBS": "10",
        "LLVM_PARALLEL_LINK_JOBS": "10"
      }
    }
  ]
}
CATEOF
cd /llvm-src/llvm && cmake --preset release
cd /llvm-build && ninja install
RUNEOF

# # basic check
RUN <<RUNEOF
set -ex
mkdir /work
cd /work
cat <<'CATEOF' > main.c
#include <stdio.h>
int main(void) {
    printf("hello world c!\n");
}
CATEOF
cat <<'CATEOF' > main.cpp
#include <print>
auto main() -> int {
    std::println("hello {}!", "world cpp");
}
CATEOF
/llvm-install/bin/clang -c main.c -o main.c.o
/llvm-install/bin/clang main.c.o -o main.1 -fuse-ld=/llvm-install/bin/ld.lld
./main.1
/llvm-install/bin/clang++ -c main.cpp -o main.cpp.o -I/llvm-install/include/c++/v1 -stdlib=libc++ -std=c++23
/llvm-install/bin/clang++ main.cpp.o -o main.2 -fuse-ld=/llvm-install/bin/ld.lld -L/llvm-install/lib/x86_64-alpine-linux-musl -lc++ -Wl,-rpath=/llvm-install/lib/x86_64-alpine-linux-musl
./main.2
RUNEOF

# docker build --target llvm-stage2 --tag my/llvm:1 .
FROM alpine:3.23.3 AS llvm-stage2

# # why is previous stage unexpectedly cache miss?
# ADD --chown=0 llvm-project.tar.xz /llvm-src
# apk add xz && tar -cJf llvm-stage1.tar.xz -C /llvm-install .
# docker cp container:/llvm-stage1.tar.xz llvm-stage1.tar.xz
# ADD --chown=0 llvm-stage1.tar.xz /usr/local

# use same add tar command can reuse layer
# COPY --from=llvm-stage1 /llvm-src /llvm-src
ADD --chown=0 llvm-project.tar.xz /llvm-src
COPY --from=my/llvm:stage1 /llvm-install /usr/local

COPY --from=my/shell:1 /etc/apk/repositories /etc/apk/repositories
# libstdc++, libgcc: gcc built clang itself still need libgcc and libstdc++ to run
# musl-dev: this is the libc/posix headers, you need them in hello world and all c/c++ programs
# libatomic: c++ helloworld with include <print> need this lib to run
# cmake, ninja, git, zlib-dev, python3, linux-headers: same as before
RUN apk add --no-cache libstdc++ libgcc musl-dev libatomic cmake ninja git zlib-dev python3 linux-headers

# cmake variable differences
# - clang-tools-extra: build clangd and clang-tidy by the way
# - no need CMAKE_C_COMPILER, CMAKE_CXX_COMPILER, there is no gcc but only clang in PATH
# - LLVM_ENABLE_LIBCXX was investigated, seems not needed
# - LLVM_BUILD_LLVM_DYLIB dynamic library required in postgres -Dllvm
# - add more j because clang and llvm use less memory
RUN <<RUNEOF
set -ex
ln -sf /usr/local/bin/ld.lld /usr/local/bin/ld
echo "/usr/lib:/usr/local/lib/x86_64-alpine-linux-musl" > /etc/ld-musl-x86_64.path
cat <<'CATEOF' > /llvm-src/llvm/CMakePresets.json
{
  "version": 10,
  "configurePresets": [
    {
      "name": "release",
      "generator": "Ninja",
      "binaryDir": "/llvm-build",
      "cacheVariables": {
        "CMAKE_BUILD_TYPE": "Release",
        "CMAKE_INSTALL_PREFIX": "/llvm-install",
        "LLVM_ENABLE_PROJECTS": "clang;lld;clang-tools-extra",
        "LLVM_ENABLE_RUNTIMES": "compiler-rt;libcxx;libcxxabi;libunwind",
        "LLVM_TARGETS_TO_BUILD": "X86",
        "LLVM_DEFAULT_TARGET_TRIPLE": "x86_64-alpine-linux-musl",
        "LLVM_BUILD_LLVM_DYLIB": true,
        "LLVM_INCLUDE_TESTS": false,
        "LLVM_INCLUDE_EXAMPLES": false,
        "CLANG_DEFAULT_CXX_STDLIB": "libc++",
        "CLANG_DEFAULT_RTLIB": "compiler-rt",
        "COMPILER_RT_BUILD_GWP_ASAN": false,
        "LIBCXX_HAS_MUSL_LIBC": true,
        "LIBCXX_USE_COMPILER_RT": true,
        "LIBCXXABI_USE_COMPILER_RT": true,
        "LLVM_PARALLEL_COMPILE_JOBS": "16",
        "LLVM_PARALLEL_LINK_JOBS": "16"
      }
    }
  ]
}
CATEOF
cd /llvm-src/llvm && cmake --preset release
cd /llvm-build && ninja install
RUNEOF

# # basic check
RUN <<RUNEOF
set -ex
mkdir /work
cd /work
cat <<'CATEOF' > main.c
#include <stdio.h>
int main(void) {
    printf("hello world c!\n");
}
CATEOF
cat <<'CATEOF' > main.cpp
#include <print>
auto main() -> int {
    std::println("hello {}!", "world cpp");
}
CATEOF
/llvm-install/bin/clang -c main.c -o main.c.o
/llvm-install/bin/clang main.c.o -o main.1
./main.1
/llvm-install/bin/clang++ -c main.cpp -o main.cpp.o -I/llvm-install/include/c++/v1 -std=c++23
/llvm-install/bin/clang++ main.cpp.o -o main.2 -lc++ -Wl,-rpath=/llvm-install/lib/x86_64-alpine-linux-musl
./main.2
RUNEOF

# docker build --target llvm-shell --tag my/llvm-shell:1 .
FROM my/shell:1 AS llvm-shell

COPY --from=my/llvm:stage2 /llvm-install /usr/local

# add cmake: although I don't use cmake before, it seems clangd works better with cmake
RUN <<RUNEOF
set -ex
apk add --no-cache musl-dev cmake ninja
ln -sf /usr/local/bin/ld.lld /usr/local/bin/ld
echo "/usr/lib:/usr/local/lib/x86_64-alpine-linux-musl" > /etc/ld-musl-x86_64.path
clang -v
ld -v
mkdir /work
cd /work
cat <<'CATEOF' > main.c
#include <stdio.h>
int main(void) {
    printf("hello world c!\n");
}
CATEOF
cat <<'CATEOF' > main.cpp
#include <print>
auto main() -> int {
    std::println("hello {}!", "world cpp");
}
CATEOF
clang -c main.c -o main.c.o && clang main.c.o -o main.1 && ./main.1
clang++ -c main.cpp -o main.cpp.o -std=c++23 && clang++ main.cpp.o -o main.2 && ./main.2
cd /
rm -rf /work
RUNEOF
