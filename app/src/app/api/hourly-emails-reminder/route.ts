import sgMail from "@sendgrid/mail";
import { cookies } from "next/headers";
import { env } from "@/env/server.mjs";
import { handleEndpointError, lockWithHourlyTimer } from "@/libs/gamesettings";
import {
  listEmailReminderForGET,
  updateEmailReminderForGET,
  updateEmailReminderForGET2,
  updateUserDataForGET,
} from "@/queries/emailReminder";
import { drizzleDB } from "@/server/db";
import { authenticateCronRequest } from "@/server/utils/cron";

const ENDPOINT_NAME = "hourly-emails-reminder";

export async function GET(request: Request) {
  const authError = authenticateCronRequest(request);
  if (authError) return authError;

  // disable cache for this server action (https://github.com/vercel/next.js/discussions/50045)
  await cookies();

  // Connect to SendGrid
  sgMail.setApiKey(env.SENDGRID_API_KEY || "");

  // Check timer
  const timerCheck = await lockWithHourlyTimer(drizzleDB, ENDPOINT_NAME);
  if (!timerCheck.isNewHour && timerCheck.response) return timerCheck.response;

  try {
    // Fetch all the emails currently in the database
    const reminders = await listEmailReminderForGET(drizzleDB);

    // Send email for each reminder
    await Promise.all(
      reminders.map(async (reminder: (typeof reminders)[number]) => {
        const msg = {
          to: reminder.email,
          from: "contact@theninja-rpg.com",
          subject: "We miss you at TheNinja-RPG",
          templateId: "d-95b2000ec19f47b1bedc331cf5cd19dd",
          dynamicTemplateData: {
            first_name: reminder.callName,
            unsubscribeUrl: `https://www.theninja-rpg.com/emailsettings?email=${reminder.email}&secret=${reminder.secret}`,
          },
        };
        await sgMail
          .send(msg)
          .then(async (response: any) => {
            console.log("RESPONSE: ", response);
            await Promise.all([
              updateEmailReminderForGET(drizzleDB, reminder),
              ...(reminder.userId
                ? [updateUserDataForGET(drizzleDB, { userId: reminder.userId })]
                : []),
            ]);
          })
          .catch(async (error: any) => {
            console.log("ERROR: ", error);
            await updateEmailReminderForGET2(drizzleDB, reminder);
          });
      }),
    );

    return Response.json(`OK. Send emails to ${reminders.length} users`);
  } catch (cause) {
    await timerCheck.release();
    return await handleEndpointError(cause);
  }
}
