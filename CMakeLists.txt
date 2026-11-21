cmake_minimum_required(VERSION 3.13)

project(tree-sitter-javascript
        VERSION "4.0.1"
        DESCRIPTION "JavaScript grammar for tree-sitter"
        HOMEPAGE_URL "https://github.com/wotjr1649/tree-sitter-javascript"
        LANGUAGES C)

option(BUILD_SHARED_LIBS "Build using shared libraries" ON)
option(TREE_SITTER_REUSE_ALLOCATOR "Reuse the library allocator" OFF)

file(STRINGS "${CMAKE_CURRENT_SOURCE_DIR}/ci/tree-sitter-abi.txt" TREE_SITTER_DEFAULT_ABI_VERSION)
set(TREE_SITTER_ABI_VERSION "${TREE_SITTER_DEFAULT_ABI_VERSION}" CACHE STRING "Tree-sitter ABI version")
if(NOT "${TREE_SITTER_ABI_VERSION}" MATCHES "^[0-9]+$")
    unset(TREE_SITTER_ABI_VERSION CACHE)
    message(FATAL_ERROR "TREE_SITTER_ABI_VERSION must be an integer")
endif()

# Use the ABI of the source being compiled. TREE_SITTER_ABI_VERSION controls ts-generate.
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS src/parser.c)
file(STRINGS "${CMAKE_CURRENT_SOURCE_DIR}/src/parser.c" PARSER_ABI_DEFINE
     LIMIT_COUNT 1 REGEX "^#define LANGUAGE_VERSION [0-9]+$")
if(NOT PARSER_ABI_DEFINE MATCHES "^#define LANGUAGE_VERSION ([0-9]+)$")
    message(FATAL_ERROR "Cannot read LANGUAGE_VERSION from src/parser.c")
endif()
set(PARSER_ABI_VERSION "${CMAKE_MATCH_1}")

include(GNUInstallDirs)

add_library(tree-sitter-javascript src/parser.c)
if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/src/scanner.c)
  target_sources(tree-sitter-javascript PRIVATE src/scanner.c)
endif()
target_include_directories(tree-sitter-javascript
                           PRIVATE src
                           INTERFACE $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/bindings/c>
                                     $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>)

target_compile_definitions(tree-sitter-javascript PRIVATE
                           $<$<BOOL:${TREE_SITTER_REUSE_ALLOCATOR}>:TREE_SITTER_REUSE_ALLOCATOR>
                           $<$<CONFIG:Debug>:TREE_SITTER_DEBUG>)

set_target_properties(tree-sitter-javascript
                      PROPERTIES
                      C_STANDARD 11
                      POSITION_INDEPENDENT_CODE ON
                      SOVERSION "${PARSER_ABI_VERSION}.${PROJECT_VERSION_MAJOR}"
                      DEFINE_SYMBOL "")

foreach(dir IN ITEMS LIBDIR INCLUDEDIR)
    if(IS_ABSOLUTE "${CMAKE_INSTALL_${dir}}")
        set(PC_${dir} "${CMAKE_INSTALL_${dir}}")
    else()
        set(PC_${dir} "\${prefix}/${CMAKE_INSTALL_${dir}}")
    endif()
endforeach()
configure_file(bindings/c/tree-sitter-javascript.pc.in
               "${CMAKE_CURRENT_BINARY_DIR}/tree-sitter-javascript.pc" @ONLY)

install(DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/bindings/c/tree_sitter"
        DESTINATION "${CMAKE_INSTALL_INCLUDEDIR}"
        FILES_MATCHING PATTERN "*.h")
install(FILES "${CMAKE_CURRENT_BINARY_DIR}/tree-sitter-javascript.pc"
        DESTINATION "${CMAKE_INSTALL_LIBDIR}/pkgconfig")
install(TARGETS tree-sitter-javascript
        LIBRARY DESTINATION "${CMAKE_INSTALL_LIBDIR}")

file(GLOB QUERIES queries/*.scm)
install(FILES ${QUERIES}
        DESTINATION "${CMAKE_INSTALL_DATADIR}/tree-sitter/queries/javascript")

find_program(TREE_SITTER_CLI tree-sitter DOC "Tree-sitter CLI")
if(TREE_SITTER_CLI)
    add_custom_target(ts-generate
                      COMMAND "${TREE_SITTER_CLI}" generate --abi "${TREE_SITTER_ABI_VERSION}" --js-runtime native
                      WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
                      VERBATIM)
    add_custom_target(ts-test "${TREE_SITTER_CLI}" test
                      WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
                      VERBATIM)
endif()
