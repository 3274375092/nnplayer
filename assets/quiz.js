function setupQuiz(root) {
  const correct = root.dataset.correct;
  const feedback = root.querySelector("[data-feedback]");
  const buttons = [...root.querySelectorAll("button[data-answer]")];

  for (const button of buttons) {
    button.addEventListener("click", () => {
      const isCorrect = button.dataset.answer === correct;

      for (const option of buttons) {
        option.classList.remove("is-correct", "is-wrong");
        option.setAttribute("aria-pressed", "false");
      }

      button.classList.add(isCorrect ? "is-correct" : "is-wrong");
      button.setAttribute("aria-pressed", "true");

      if (!feedback) return;
      feedback.textContent = isCorrect
        ? root.dataset.correctFeedback || "答对了。"
        : root.dataset.wrongFeedback || "再沿着数据流想一次。";
    });
  }
}

document.querySelectorAll("[data-quiz]").forEach(setupQuiz);
