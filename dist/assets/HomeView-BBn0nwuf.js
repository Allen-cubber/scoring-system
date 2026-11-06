import { _ as defineComponent, c as createBlock, a as element, o as openBlock } from "./index-DZrXHx6s.js";

const steps = [
  {
    title: "设置评分标准", page: "评分项设置", href: "/settings",
    description: "先创建评分组，再为该组添加评分项，填写名称、说明和满分。评分组用于区分不同赛道或评分标准。",
    tips: "也可以通过 Excel 批量导入：按“组名、评分项名称、说明、满分”的列顺序准备数据，不添加表头。比赛开始前核对各项满分。"
  },
  {
    title: "录入参赛选手", page: "选手管理", href: "/players",
    description: "手动添加选手姓名和简介，或使用 Excel 批量导入。导入后检查名单，确认没有漏录或重复记录。",
    tips: "选手导入文件：A 列为姓名，B 列为简介，不添加表头。建议在姓名中带上参赛编号，便于区分重名选手。"
  },
  {
    title: "让评委进入评分页面", page: "本机预览评委页面", href: "/judge",
    description: "让评委手机与服务器电脑连接可互访的网络。在“评分服务启动器”中选择对应网卡，复制评委链接并发给评委。",
    tips: "手机应打开 http://电脑的IP地址:3000/judge，不能使用 localhost。正式开始前，先用一部手机完成一次试评分。"
  },
  {
    title: "开启当前选手的评分", page: "评分控制台", href: "/control",
    description: "先选择本场使用的评分组，再找到当前选手并点击“开始评分”。评委页面会自动同步，通常需要等待几秒。",
    tips: "每次只为当前选手开放评分。建议整场沿用同一评分组；评分过程中不要切换评分组或修改评分项，以免影响成绩。"
  },
  {
    title: "提交评分与切换选手",
    description: "评委核对选手姓名，调整各评分项的分值后提交，并确认页面出现提交成功提示。评分通道开放期间，可以再次提交以修改自己的评分。",
    tips: "管理员确认评委提交完毕后，停止评分或开启下一位选手。评委应始终使用同一台设备、同一浏览器和同一链接，不要清除浏览器数据或使用无痕模式。"
  },
  {
    title: "查看成绩与保存数据", page: "查看评分结果", href: "/control",
    description: "在评分控制台查看对应评分组的结果，核对评委人数、总分和平均分，并按比赛事先约定的计分规则确认成绩。",
    tips: "比赛结束后关闭评分通道，等待提交完成，再停止服务。将项目目录中的 scoring.db 复制到备份位置，保存本场比赛数据。"
  }
];

const questions = [
  ["手机打不开评分页面？", "检查电脑服务是否运行、手机与电脑是否网络互通，以及链接中的 IP 是否正确。校园网或访客 Wi-Fi 可能隔离设备；必要时改用允许设备互访的独立路由器，并检查 Windows 防火墙是否允许 Node.js 通信。"],
  ["评委页面没有显示选手？", "先在控制台选择评分组，再为选手开启评分，并确认该组已添加评分项。等待几秒；仍未显示时，检查网络后刷新页面。"],
  ["提交失败或没有成功提示？", "先确认网络正常、该选手评分通道仍然开放，再核对页面上的选手并重新提交。以提交成功提示为准，不要仅凭滑块已调整就认为成绩已保存。"],
  ["可以关闭电脑或让电脑休眠吗？", "评分期间电脑需要持续开机、联网并运行服务。建议接通电源、保持启动器打开，避免合盖、手动休眠或重启。停止服务后，手机将无法继续评分。"]
];

function render() {
  openBlock();
  return createBlock("main", { class: "home-page" }, [
    element("h1", null, "欢迎来到评分系统后台"),
    element("section", { class: "home-manual", "aria-labelledby": "manual-title" }, [
      element("header", { class: "home-manual__header" }, [
        element("span", { class: "home-manual__eyebrow" }, "从准备到收尾"),
        element("h2", { id: "manual-title" }, "系统使用手册"),
        element("p", null, "按照下面 6 个步骤完成比赛设置与现场评分。首次使用时，建议先安排一次完整演练。")
      ]),
      element("ol", { class: "home-manual__steps" }, steps.map((step, index) =>
        element("li", { class: "home-manual__step", key: step.title }, [
          element("div", { class: "home-manual__step-heading" }, [
            element("span", { class: "home-manual__number", "aria-hidden": "true" }, String(index + 1).padStart(2, "0")),
            element("h3", null, step.title)
          ]),
          element("p", null, step.description),
          element("p", { class: "home-manual__tip" }, step.tips),
          ...(step.href ? [element("a", {
            class: "home-manual__link", href: step.href,
            ...(step.href === "/judge" ? { target: "_blank", rel: "noopener noreferrer" } : {})
          }, step.page + " →")] : [])
        ])
      )),
      element("section", { class: "home-manual__faq", "aria-labelledby": "manual-faq-title" }, [
        element("h3", { id: "manual-faq-title" }, "现场常见问题"),
        ...questions.map(([question, answer]) => element("details", { key: question }, [
          element("summary", null, question), element("p", null, answer)
        ]))
      ])
    ])
  ]);
}

export default defineComponent({}, [["render", render]]);
