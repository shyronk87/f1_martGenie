import asyncio

from src.model.user_content_analysis import analyze_user_content


async def main() -> None:
    print("多轮对话测试已启动。输入 q/quit/exit 结束。")
    conversation: list[dict[str, str]] = []

    while True:
        user_text = input("\n你: ").strip()
        if not user_text:
            continue
        if user_text.lower() in {"q", "quit", "exit"}:
            print("测试结束。")
            break

        conversation.append({"role": "user", "content": user_text})
        result = await analyze_user_content(conversation)

        print("\n结构化结果(JSON):")
        print(result.model_dump_json(ensure_ascii=False, indent=2))
        print("\nagent_reply:")
        print(result.agent_reply)

        # 把模型回复加入历史，便于下一轮承接上下文。
        conversation.append({"role": "assistant", "content": result.agent_reply})


if __name__ == "__main__":
    asyncio.run(main())
