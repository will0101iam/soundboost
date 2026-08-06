cmake_minimum_required(VERSION 3.22.1)

project(soundboost_rnnoise LANGUAGES C)

add_library(rnnoise_core STATIC
    rnnoise/src/denoise.c
    rnnoise/src/rnn.c
    rnnoise/src/rnn_data.c
    rnnoise/src/rnn_reader.c
    rnnoise/src/pitch.c
    rnnoise/src/kiss_fft.c
    rnnoise/src/celt_lpc.c
)

target_include_directories(rnnoise_core
    PUBLIC
        "${CMAKE_CURRENT_SOURCE_DIR}/rnnoise/include"
    PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/rnnoise/src"
)

target_compile_definitions(rnnoise_core PRIVATE RNNOISE_BUILD)

set_target_properties(rnnoise_core PROPERTIES
    C_STANDARD 99
    C_STANDARD_REQUIRED YES
    C_EXTENSIONS NO
    POSITION_INDEPENDENT_CODE ON
)

target_link_libraries(rnnoise_core PUBLIC m)
