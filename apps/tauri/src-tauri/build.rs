fn main() {
    println!("cargo:rerun-if-changed=src/process_audio.cpp");
    cc::Build::new()
        .cpp(true)
        .file("src/process_audio.cpp")
        .compile("process_audio");
    println!("cargo:rustc-link-lib=mmdevapi");
    println!("cargo:rustc-link-lib=ole32");
    tauri_build::build();
}
