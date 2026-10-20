#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommandError {
    code: &'static str,
    message: &'static str,
    detail: String,
}

impl CommandError {
    pub(crate) fn busy(detail: String) -> Self {
        Self {
            code: "write_busy",
            message: "数据写入或备份任务正在运行",
            detail,
        }
    }

    pub(crate) fn scan(detail: String) -> Self {
        Self {
            code: "scan_failed",
            message: "扫描失败",
            detail,
        }
    }

    pub(crate) fn import(detail: String) -> Self {
        Self {
            code: "import_failed",
            message: "导入失败",
            detail,
        }
    }
}
