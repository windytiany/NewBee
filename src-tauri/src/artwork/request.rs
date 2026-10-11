pub(crate) const SIZES: [u32; 3] = [128, 512, 2048];

pub(crate) fn validate_size(size: Option<u32>) -> Result<(), String> {
    if size.is_some_and(|size| !SIZES.contains(&size)) {
        return Err("封面尺寸必须为 128、512 或 2048".into());
    }
    Ok(())
}
