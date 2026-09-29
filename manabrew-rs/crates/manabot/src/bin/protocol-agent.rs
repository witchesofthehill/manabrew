use std::io::{BufRead, Write};

use manabot::{BotAgent, SimpleAi};
use manabrew_protocol::game::TargetingIntent;
use manabrew_protocol::prompts::{
    ChooseNumberOutput, ChooseObjectOutput, PromptInput, PromptOutput,
};
use manabrew_protocol::transport::{AgentPrompt, ClientToServerMessage};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut hold_attackers = false;
    let mut number_choice = None;
    let mut confirm_label = None;
    let mut target_count = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--target-count" => {
                target_count = Some(args.next().ok_or("missing target count")?.parse::<u32>()?)
            }
            "--confirm-label" => confirm_label = Some(args.next().ok_or("missing confirm label")?),
            "--hold-attackers" => hold_attackers = true,
            "--number-choice" => {
                number_choice = Some(args.next().ok_or("missing number choice")?.parse::<i32>()?)
            }
            _ => return Err(format!("unknown argument: {arg}").into()),
        }
    }
    let mut agent = SimpleAi::with_single_step_passes();
    let mut output = std::io::stdout().lock();
    for line in std::io::stdin().lock().lines() {
        let prompt: AgentPrompt = serde_json::from_str(&line?)?;
        let prompt_id = prompt.prompt_id;
        let input = prompt.input.clone();
        let action = if hold_attackers
            && matches!(&input, PromptInput::ChooseObject(choice) if choice.intent == TargetingIntent::Attack && choice.can_finish)
        {
            PromptOutput::ChooseObject(ChooseObjectOutput::Finish)
        } else if matches!(&input, PromptInput::ChooseBoolean(choice) if confirm_label.as_ref() == Some(&choice.confirm_label))
        {
            PromptOutput::ChooseBoolean(manabrew_protocol::prompts::ChooseBooleanOutput::Decision {
                value: true,
            })
        } else if let (Some(count), PromptInput::ChooseBoardTargets(choice)) =
            (target_count, &input)
        {
            let count = i32::try_from(count)?.clamp(choice.min_targets, choice.max_targets);
            let take = count.saturating_sub(choice.chosen_targets).max(0) as usize;
            let mut candidates = choice.candidates.clone();
            candidates.sort_by_key(|target| target.id == prompt.deciding_player_id);
            PromptOutput::ChooseBoardTargets(
                manabrew_protocol::prompts::ChooseBoardTargetsOutput::BoardTargets {
                    chosen: candidates.into_iter().take(take).collect(),
                },
            )
        } else if let (Some(value), PromptInput::ChooseNumber(choice)) = (number_choice, &input) {
            PromptOutput::ChooseNumber(ChooseNumberOutput::NumberDecision {
                chosen_number: Some(value.clamp(choice.min, choice.max)),
            })
        } else {
            agent.decide(prompt).ok_or("agent produced no decision")?
        };
        input
            .validate_response(&action)
            .map_err(|error| format!("invalid decision: {error:?}"))?;
        serde_json::to_writer(
            &mut output,
            &ClientToServerMessage::Response { prompt_id, action },
        )?;
        writeln!(output)?;
        output.flush()?;
    }
    Ok(())
}
