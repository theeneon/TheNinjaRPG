import { type NextPage } from "next";
import ContentBox from "../layout/ContentBox";
import Loader from "../layout/Loader";
import { useRequiredUserData } from "../utils/UserContext";

const BlackMarket: NextPage = () => {
  const { data: userData } = useRequiredUserData();
  if (!userData) return <Loader explanation="Loading userdata" />;
  return (
    <ContentBox
      title="Black Market"
      subtitle="High-valid items for reputation points"
      back_href="/village"
    >
      WIP
    </ContentBox>
  );
};

export default BlackMarket;