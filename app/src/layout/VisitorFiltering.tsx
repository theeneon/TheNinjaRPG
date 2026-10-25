import {
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  useContentFiltering,
} from "@/layout/ContentFiltering";

// Helper: get date string (YYYY-MM-DD) for N months ago
const dateStringMonthsAgo = (months: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() - months);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// Inline schema for visitor analytics filters
const visitorFilteringSchema = defineFilteringSchema({
  fields: [
    {
      id: "utmSource",
      label: "UTM Source",
      type: "single-select",
      defaultValue: "None",
      dataSource: "visitorUtmSources",
      includeNone: true,
      noneOption: { value: "None", label: "All" },
      emptyValues: ["None"],
    },
    {
      id: "deviceType",
      label: "Device Type",
      type: "multi-select",
      defaultValue: [],
      options: [
        { value: "mobile", label: "Mobile" },
        { value: "desktop", label: "Desktop" },
        { value: "unknown", label: "Unknown" },
      ],
    },
    {
      id: "startDate",
      label: "First Visit (From)",
      type: "date",
      defaultValue: dateStringMonthsAgo(1),
      visibleIf: (ctx) =>
        (ctx as { includeDates?: boolean } | undefined)?.includeDates !== false,
    },
    {
      id: "endDate",
      label: "First Visit (To)",
      type: "date",
      defaultValue: "",
      visibleIf: (ctx) =>
        (ctx as { includeDates?: boolean } | undefined)?.includeDates !== false,
    },
  ] as const,
});

interface VisitorFilteringProps {
  state: VisitorFilteringState;
  includeDates?: boolean;
}

const VisitorFiltering: React.FC<VisitorFilteringProps> = (props) => {
  return (
    <ContentFiltering
      schema={visitorFilteringSchema}
      state={props.state.cf}
      context={{ includeDates: props.includeDates }}
      triggerButtonId="filter-visitor"
    />
  );
};

export default VisitorFiltering;

export const getFilter = (state: VisitorFilteringState, includeDates = true) => {
  const filter = buildFilter(state.cf, visitorFilteringSchema);
  if (!includeDates) {
    delete filter.startDate;
    delete filter.endDate;
  }
  return filter;
};

export const useFiltering = () => {
  const cf = useContentFiltering(visitorFilteringSchema);
  return {
    ...cf.values,
    cf,
    setUtmSource: cf.setters.utmSource,
    setDeviceType: cf.setters.deviceType,
    setStartDate: cf.setters.startDate,
    setEndDate: cf.setters.endDate,
  };
};

export type VisitorFilteringState = ReturnType<typeof useFiltering>;
